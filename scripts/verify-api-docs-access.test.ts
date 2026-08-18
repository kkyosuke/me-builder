import { describe, expect, it, vi } from "vitest";
import { verifyApiDocsAccess } from "./verify-api-docs-access";

describe("verify-api-docs-access", () => {
  it("Cloudflare Accessのlogin redirectを保護済みと判定する", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/api" },
      }),
    );

    await expect(
      verifyApiDocsAccess({ baseDomain: "example.com", fetch: fetchMock }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/openapi.json", {
      redirect: "manual",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/docs", {
      redirect: "manual",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/docs/index.html", {
      redirect: "manual",
    });
  });

  it.each([401, 403])("明示的な拒否status %iを保護済みと判定する", async (status) => {
    await expect(
      verifyApiDocsAccess({
        baseDomain: "example.com",
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    [200, undefined],
    [302, "https://example.com/sign-in"],
    [404, undefined],
  ])("Accessによる拒否を確認できないstatus %iを失敗させる", async (status, location) => {
    await expect(
      verifyApiDocsAccess({
        baseDomain: "example.com",
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status, headers: location ? { location } : {} })),
      }),
    ).rejects.toThrow("API documentation is not protected by Cloudflare Access");
  });

  it("OpenAPIだけでなくSwagger UI配下の未保護も失敗させる", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      verifyApiDocsAccess({ baseDomain: "example.com", fetch: fetchMock }),
    ).rejects.toThrow("404 from https://api.example.com/api/docs");
  });
});
