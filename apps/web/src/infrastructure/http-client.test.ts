import { beforeEach, describe, expect, it, vi } from "vitest";
import { authSessionRuntime } from "../feature/auth/infrastructure/auth-session-runtime";
import { createAuthenticatedHttpClient, createHttpClient } from "./http-client";

describe("createHttpClient", () => {
  beforeEach(() => authSessionRuntime.reset());

  it("ベースURLとパスを結合してfetchへ委譲する", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const client = createHttpClient("https://api.example.com///", fetchImplementation);
    const init = { headers: { Authorization: "Bearer token" } };

    const response = await client.request("api/diagnoses", init);

    expect(fetchImplementation).toHaveBeenCalledWith("https://api.example.com/api/diagnoses", init);
    expect(response.status).toBe(204);
  });

  it("ベースURLが未設定なら同一オリジンの絶対パスを使う", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response());
    const client = createHttpClient(undefined, fetchImplementation);

    await client.request("/api/diagnoses");

    expect(fetchImplementation).toHaveBeenCalledWith("/api/diagnoses", undefined);
  });

  it("パス先頭のスラッシュを1つに正規化する", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response());
    const client = createHttpClient("https://api.example.com", fetchImplementation);

    await client.request("///api/diagnoses");

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.example.com/api/diagnoses",
      undefined,
    );
  });

  it("状態変更requestへsessionのCSRF headerを付ける", async () => {
    authSessionRuntime.setCsrfToken("csrf-token");
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );

    await createAuthenticatedHttpClient("https://api.example.com", fetchImplementation).request(
      "/api/profile",
      { method: "PUT" },
    );

    const headers = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
  });

  it("401では共有sessionを一度再確認する", async () => {
    const recheck = vi.fn(async () => undefined);
    authSessionRuntime.installRecheck(recheck);
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 401 }),
    );
    const client = createAuthenticatedHttpClient("https://api.example.com", fetchImplementation);

    await Promise.all([client.request("/api/profile"), client.request("/api/diagnoses")]);

    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("最初のrequestがAbortされても別requestの共有session再確認を継続する", async () => {
    let finishRecheck: (() => void) | undefined;
    const recheck = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRecheck = resolve;
        }),
    );
    authSessionRuntime.installRecheck(recheck);
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 401 }),
    );
    const client = createAuthenticatedHttpClient("https://api.example.com", fetchImplementation);
    const firstController = new AbortController();

    const first = client.request("/api/profile", { signal: firstController.signal });
    await vi.waitFor(() => expect(recheck).toHaveBeenCalledTimes(1));
    firstController.abort();
    const second = client.request("/api/diagnoses");
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
    expect(recheck).toHaveBeenCalledTimes(1);

    finishRecheck?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("application session requestにはcookieを含める", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response());

    await createAuthenticatedHttpClient("https://api.example.com", fetchImplementation).request(
      "/api/profile",
    );

    expect(fetchImplementation).toHaveBeenCalledWith("https://api.example.com/api/profile", {
      credentials: "include",
    });
  });
});
