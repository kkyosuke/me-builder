// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWebErrorReporter,
  firstPartyErrorFrame,
  firstPartyScriptFile,
  installGlobalWebErrorHandlers,
  operationalWebRoute,
  webClientErrorType,
} from "./web-error-reporter";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web error reporter", () => {
  it("動的IDと未知pathを実値のまま送らない", () => {
    expect(operationalWebRoute("/diagnosis/money-values/answers")).toBe(
      "/diagnosis/:diagnosisId/answers",
    );
    expect(operationalWebRoute("/compatibility/invitations/secret-capability")).toBe(
      "/compatibility/invitations/:relationshipId",
    );
    expect(operationalWebRoute("/unknown/private-value")).toBe("unknown");
  });

  it("標準例外分類と自Originのbundle名だけを抽出する", () => {
    expect(webClientErrorType(new TypeError("secret message"))).toBe("TypeError");
    expect(webClientErrorType({ message: "secret object" })).toBe("NonError");
    expect(
      firstPartyScriptFile(
        "https://web.example/assets/index-AbC_123.js?token=secret",
        "https://web.example",
      ),
    ).toBe("index-AbC_123.js");
    expect(
      firstPartyScriptFile("https://third-party.example/assets/vendor.js", "https://web.example"),
    ).toBeUndefined();
    expect(
      firstPartyScriptFile("https://web.example/private/secret.js", "https://web.example"),
    ).toBeUndefined();
    const renderError = new TypeError("secret message");
    renderError.stack = [
      "TypeError: secret message",
      "    at thirdParty (https://third-party.example/assets/vendor.js:1:2)",
      "    at render (https://web.example/assets/route-AbC_123.js?token=secret:42:7)",
    ].join("\n");
    expect(firstPartyErrorFrame(renderError, "https://web.example")).toEqual({
      sourceFile: "route-AbC_123.js",
      sourceLine: 42,
      sourceColumn: 7,
    });
  });

  it("生のmessage・stack・URLを含めず、同一エラーを5分間重複送信しない", async () => {
    let now = 1_000;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const reporter = createWebErrorReporter({
      apiUrl: "https://api.example/",
      release: "abcdef123456",
      csrfToken: () => "csrf-session-token",
      fetch,
      now: () => now,
      browserContext: () => ({
        origin: "https://web.example",
        pathname: "/compatibility/relationships/secret-relationship-id",
        online: true,
      }),
    });
    const error = new TypeError("diagnosis answer: secret");
    error.stack = "secret stack";
    const input = {
      kind: "unhandled-error" as const,
      error,
      filename: "https://web.example/assets/index-AbC_123.js?token=secret",
      line: 42,
      column: 7,
    };

    reporter.report(input);
    reporter.report(input);
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/api/observability/web-errors",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-session-token",
        },
      }),
    );
    const body = String(fetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toEqual({
      schemaVersion: 1,
      kind: "unhandled-error",
      route: "/compatibility/relationships/:relationshipId",
      release: "abcdef123456",
      errorType: "TypeError",
      sourceFile: "index-AbC_123.js",
      sourceLine: 42,
      sourceColumn: 7,
      online: true,
      recovered: false,
    });
    expect(body).not.toContain("secret");

    now += 5 * 60 * 1_000;
    reporter.report(input);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("送信失敗を再送出せず、未捕捉ハンドラの登録を解除できる", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    const reporter = createWebErrorReporter({
      apiUrl: "https://api.example",
      release: "development",
      csrfToken: () => "csrf-session-token",
      fetch,
      now: () => 1,
      browserContext: () => ({ origin: "https://web.example", pathname: "/me", online: false }),
    });
    expect(() =>
      reporter.report({ kind: "render-error", error: new Error("render") }),
    ).not.toThrow();
    await Promise.resolve();

    const synchronouslyFailingReporter = createWebErrorReporter({
      apiUrl: "https://api.example",
      release: "development",
      csrfToken: () => "csrf-session-token",
      fetch: (() => {
        throw new Error("synchronous failure");
      }) as typeof globalThis.fetch,
      now: () => 1,
      browserContext: () => ({ origin: "https://web.example", pathname: "/me", online: false }),
    });
    expect(() =>
      synchronouslyFailingReporter.report({ kind: "render-error", error: new Error("render") }),
    ).not.toThrow();

    const report = vi.fn();
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const dispose = installGlobalWebErrorHandlers(window, { report });
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("secret"),
        filename: "https://web.example/assets/index.js",
        lineno: 3,
        colno: 4,
      }),
    );
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("secret rejection") });
    window.dispatchEvent(rejection);

    expect(report).toHaveBeenNthCalledWith(1, {
      kind: "unhandled-error",
      error: expect.any(TypeError),
      filename: "https://web.example/assets/index.js",
      line: 3,
      column: 4,
    });
    expect(report).toHaveBeenNthCalledWith(2, {
      kind: "unhandled-rejection",
      error: expect.any(Error),
    });

    dispose();
    expect(removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });

  it("CSRF tokenがない間は送信せず、描画エラーの自サイトframeだけを送る", () => {
    let csrfToken: string | null = null;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const reporter = createWebErrorReporter({
      apiUrl: "https://api.example",
      release: "abcdef123456",
      csrfToken: () => csrfToken,
      fetch,
      now: () => 1,
      browserContext: () => ({
        origin: "https://web.example",
        pathname: "/diagnosis",
        online: true,
      }),
    });
    const error = new Error("private diagnosis answer");
    error.stack =
      "Error: private diagnosis answer\n    at render (https://web.example/assets/diagnosis-XyZ.js:12:34)";

    reporter.report({ kind: "render-error", error });
    expect(fetch).not.toHaveBeenCalled();

    csrfToken = "csrf-session-token";
    reporter.report({ kind: "render-error", error });
    const body = String(fetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({
      sourceFile: "diagnosis-XyZ.js",
      sourceLine: 12,
      sourceColumn: 34,
    });
    expect(body).not.toContain("private diagnosis answer");
  });
});
