import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomerPortalSession } from "./billing-api";

describe("createCustomerPortalSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("本人のID tokenだけを送り、短命URLを返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://billing.stripe.test/session" }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createCustomerPortalSession("https://api.example.test", "id-token")).resolves.toBe(
      "https://billing.stripe.test/session",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/billing/portal-sessions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer id-token" },
      }),
    );
  });

  it("Customer対応がない利用者へ反映待ちを案内する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(createCustomerPortalSession(undefined, "id-token")).rejects.toThrow(
      "管理できる契約がまだありません",
    );
  });
});
