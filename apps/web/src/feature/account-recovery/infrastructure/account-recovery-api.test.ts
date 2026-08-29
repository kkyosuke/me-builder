import { afterEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../../../infrastructure/auth-session-runtime";
import { completeRecovery, issueRecoveryCode } from "./account-recovery-api";

describe("account recovery api", () => {
  afterEach(() => {
    authSessionRuntime.setCsrfToken(null);
    vi.unstubAllGlobals();
  });

  it("復旧コードを現在のアプリセッションだけで発行する", async () => {
    authSessionRuntime.setCsrfToken("csrf-test-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: "credential.secret", expiresAt: "2026-08-16T01:00:00.000Z" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(issueRecoveryCode("https://api.example.com")).resolves.toMatchObject({
      code: "credential.secret",
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test-token");
  });

  it("復旧完了ではコードをbodyだけへ入れ、エラー表示へ漏らさない", async () => {
    authSessionRuntime.setCsrfToken("csrf-test-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: "conflict" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const recoveryCode = "credential.must-not-leak";
    const failure = await completeRecovery(undefined, recoveryCode).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(recoveryCode);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toBe(JSON.stringify({ code: recoveryCode }));
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });

  it("復旧完了時は旧sessionを表示し続けないよう他タブへ通知する", async () => {
    authSessionRuntime.setCsrfToken("csrf-test-token");
    const notify = vi.spyOn(authSessionRuntime, "notifyExternalSessionChange");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "recovered",
          alreadyRecovered: false,
        }),
      ),
    );

    await expect(completeRecovery(undefined, "credential.secret")).resolves.toEqual({
      status: "recovered",
      alreadyRecovered: false,
    });

    expect(notify).toHaveBeenCalledOnce();
  });
});
