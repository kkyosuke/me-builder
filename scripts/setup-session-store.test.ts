import { describe, expect, it, vi } from "vitest";
import { ensureSessionStore } from "./setup-session-store";

const success = (result: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, result }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("ensureSessionStore", () => {
  it("同名のKV namespaceが存在すれば再利用する", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(success([{ id: "kv-preview", title: "me-builder-session-preview" }]));

    await expect(
      ensureSessionStore({
        accountId: "account",
        token: "token",
        environment: "preview",
        fetcher,
      }),
    ).resolves.toEqual({ id: "kv-preview", name: "me-builder-session-preview" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("同名のKV namespaceがなければ作成する", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(
        success({ id: "kv-production", title: "me-builder-session-production" }, 201),
      );

    await expect(
      ensureSessionStore({
        accountId: "account",
        token: "token",
        environment: "production",
        fetcher,
      }),
    ).resolves.toEqual({ id: "kv-production", name: "me-builder-session-production" });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account/storage/kv/namespaces",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "me-builder-session-production" }),
      }),
    );
  });

  it("Cloudflare APIの失敗を成功として扱わない", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, result: [], errors: [{ message: "denied" }] }),
        {
          status: 403,
        },
      ),
    );

    await expect(
      ensureSessionStore({
        accountId: "account",
        token: "token",
        environment: "preview",
        fetcher,
      }),
    ).rejects.toThrow("Cloudflare KV API 403: denied");
  });
});
