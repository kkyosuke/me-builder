import { logger } from "@me-builder/shared";
import type { Context, Next } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { AppEnv } from "../types";
import { readLimitedTextBody } from "./observability";

vi.mock("../middleware/authentication", () => ({
  requireAuthentication: async (c: Context<AppEnv>, next: Next) => {
    c.set("authenticatedActor", {
      accountId: "account-1",
      authenticationMethod: "liff",
      authenticatedAt: new Date("2026-08-17T00:00:00Z"),
    });
    await next();
  },
  authenticatedActor: (c: Context<AppEnv>) => c.get("authenticatedActor"),
}));
vi.mock("../middleware/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authorization")>();
  return {
    ...actual,
    requireCurrentTerms: async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

const allowedOrigin = "https://stg.kagami.example";

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: "render-error",
    route: "/diagnosis",
    release: "abcdef123456",
    errorType: "TypeError",
    sourceFile: "index-AbC_123.js",
    sourceLine: 42,
    sourceColumn: 7,
    online: true,
    recovered: false,
    ...overrides,
  };
}

function request(body: unknown, env: Record<string, unknown> = {}) {
  return app.request(
    "/api/observability/web-errors",
    {
      method: "POST",
      headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin, ...env },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/observability/web-errors", () => {
  it("安全化済みイベントをブラウザの終端ログ1件として記録する", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const limit = vi.fn().mockResolvedValue({ success: true });

    const response = await request(report(), { WEB_ERROR_RATE_LIMITER: { limit } });

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(limit).toHaveBeenCalledWith({ key: "account:account-1" });
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "web.client.failed",
        service: "web",
        environment: "preview",
        outcome: "failed",
        kind: "render-error",
        route: "/diagnosis",
        release: "abcdef123456",
        fingerprint:
          "render-error:TypeError:/diagnosis:abcdef123456:index-AbC_123.js:42:7:unknown:unknown:0",
      }),
      "[Web] render-error at /diagnosis -> failed",
    );
  });

  it("自動復旧できたchunk読み込み失敗はwarnにする", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const response = await request(
      report({ kind: "chunk-load-error", recovered: true, sourceFile: undefined }),
    );

    expect(response.status).toBe(204);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "web.client.recovered",
        outcome: "degraded",
        kind: "chunk-load-error",
      }),
      "[Web] chunk-load-error at /diagnosis -> recovered",
    );
  });

  it("UIで捕捉した課金操作エラーを原因コードとstatus付きで記録する", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const response = await request(
      report({
        kind: "handled-operation-error",
        route: "/profile/billing",
        operation: "billing-checkout",
        operationErrorCode: "BILLING_CHECKOUT_FAILED",
        operationStatus: 503,
        sourceFile: undefined,
        sourceLine: undefined,
        sourceColumn: undefined,
      }),
    );

    expect(response.status).toBe(204);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "web.client.failed",
        kind: "handled-operation-error",
        route: "/profile/billing",
        operation: "billing-checkout",
        operationErrorCode: "BILLING_CHECKOUT_FAILED",
        operationStatus: 503,
        fingerprint: expect.stringContaining("billing-checkout:BILLING_CHECKOUT_FAILED:503"),
      }),
      "[Web] handled-operation-error at /profile/billing -> failed",
    );
  });

  it("未許可Origin、任意field、過大bodyを受理しない", async () => {
    const invalidOrigin = await app.request(
      "/api/observability/web-errors",
      {
        method: "POST",
        headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
        body: JSON.stringify(report()),
      },
      { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin },
    );
    const unknownField = await request(report({ message: "must not be accepted" }));
    const oversized = await request(report({ release: "a".repeat(5_000) }));

    expect(invalidOrigin.status).toBe(403);
    expect(unknownField.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  it("Cloudflare Rate Limitingが拒否したイベントを記録しない", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const response = await request(report(), {
      WEB_ERROR_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
    });

    expect(response.status).toBe(429);
    expect(
      error.mock.calls.some(([fields]) =>
        fields && typeof fields === "object"
          ? (fields as Record<string, unknown>).event === "web.client.failed"
          : false,
      ),
    ).toBe(false);
  });
});

describe("readLimitedTextBody", () => {
  it("Content-Lengthがなくても上限超過時点でstreamをcancelする", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4_097));
      },
      cancel,
    });
    const request = new Request("https://api.example/api/observability/web-errors", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);

    await expect(readLimitedTextBody(request, 4_096)).resolves.toEqual({ tooLarge: true });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
