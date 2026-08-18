import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
});

type LogCall = [Record<string, unknown>, string];

function spyOnLogger() {
  return {
    info: vi.spyOn(logger, "info").mockImplementation(() => undefined),
    warn: vi.spyOn(logger, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(logger, "error").mockImplementation(() => undefined),
  };
}

function terminalCalls(spy: { mock: { calls: unknown[][] } }): LogCall[] {
  return spy.mock.calls.filter((call): call is LogCall => {
    const fields = call[0];
    if (typeof fields !== "object" || fields === null) return false;
    const event = (fields as Record<string, unknown>).event;
    return event === "http.request.completed" || event === "http.request.failed";
  });
}

describe("HTTPの終端ログ", () => {
  it("成功したリクエストはinfoで1件だけ記録し、messageから内容が読める", async () => {
    const log = spyOnLogger();

    const res = await app.request("/api/health", {}, { ENVIRONMENT: "test" });

    expect(res.status).toBe(200);
    expect(terminalCalls(log.warn)).toHaveLength(0);
    expect(terminalCalls(log.error)).toHaveLength(0);
    const calls = terminalCalls(log.info);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      event: "http.request.completed",
      service: "api",
      method: "GET",
      path: "/api/health",
      status: 200,
      outcome: "succeeded",
    });
    expect(calls[0]?.[1]).toMatch(/^\[API\] GET \/api\/health -> 200 \(\d+ms\)$/);
  });

  it("4xxはwarnで記録し、成功のinfoに埋もれさせない", async () => {
    const log = spyOnLogger();

    // LINE_CHANNEL_SECRET未設定は、設定状態を推測させないため401へ落とす。
    const res = await app.request(
      "/api/line/webhook",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      { ENVIRONMENT: "test" },
    );

    expect(res.status).toBe(401);
    expect(terminalCalls(log.info)).toHaveLength(0);
    const calls = terminalCalls(log.warn);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({ status: 401, outcome: "discarded" });
    expect(calls[0]?.[1]).toContain("[API] POST /api/line/webhook -> 401");
  });

  it("招待IDを実pathのまま運用ログへ記録しない", async () => {
    const log = spyOnLogger();
    const relationshipId = "a".repeat(64);

    const res = await app.request(`/api/compatibility/invitations/${relationshipId}`);

    expect(res.status).toBe(503);
    const calls = terminalCalls(log.error);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      path: "/api/compatibility/invitations/:relationshipId",
    });
    expect(calls[0]?.[1]).toContain("GET /api/compatibility/invitations/:relationshipId");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(relationshipId);
  });

  it("未捕捉例外はerror 1件にまとまり、原因分類と生の例外の非出力を満たす", async () => {
    const log = spyOnLogger();
    const secret = "本文やSDK responseを含みうる内容";
    vi.spyOn(line.webhook, "verifySignature").mockImplementation(() => {
      throw new Error(secret);
    });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-line-signature": "sig" },
        body: "{}",
      },
      { ENVIRONMENT: "test", LINE_CHANNEL_SECRET: "channel-secret" },
    );

    expect(res.status).toBe(500);
    // onErrorとmiddlewareで二重に出さず、結果1つにつき終端ログ1件へまとめる。
    expect(terminalCalls(log.info)).toHaveLength(0);
    expect(terminalCalls(log.warn)).toHaveLength(0);
    const calls = terminalCalls(log.error);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      event: "http.request.failed",
      status: 500,
      outcome: "failed",
      errorCode: "UNEXPECTED_API_ERROR",
      errorCategory: "unknown",
      stage: "http.handle",
    });
    expect(calls[0]?.[1]).toContain("-> 500");
    expect(calls[0]?.[1]).toContain("UNEXPECTED_API_ERROR");
    expect(JSON.stringify(calls)).not.toContain(secret);
  });

  it("session KV障害は500でsafe failureし、依存先と再試行可否だけを記録する", async () => {
    const log = spyOnLogger();
    const secret = "KV SDK response containing a credential";
    const res = await app.request(
      "/api/auth/session",
      { headers: { Cookie: "__Host-me_builder_session=opaque" } },
      {
        ENVIRONMENT: "test",
        DB: {} as never,
        SESSION_STORE: {
          get: async () => {
            throw new Error(secret);
          },
        } as never,
      },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    const calls = terminalCalls(log.error);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      event: "http.request.failed",
      path: "/api/auth/session",
      status: 500,
      errorCode: "SESSION_STORE_READ_FAILED",
      errorCategory: "dependency",
      stage: "authentication.session.store.read",
      retryable: true,
      dependency: "cloudflare-kv",
    });
    expect(JSON.stringify(calls)).not.toContain(secret);
  });
});
