import { describe, expect, it, vi } from "vitest";
import { serviceSitePageMetadata } from "../apps/web/src/feature/service-site/model/service-site-page-metadata";
import { verifyServiceSiteDeployment } from "./verify-service-site-deployment";

function publicDocument(pathname: string): string {
  const metadata = Object.values(serviceSitePageMetadata).find(
    (page) => page.pathname === pathname,
  );
  if (!metadata) throw new Error(`Unexpected public pathname: ${pathname}`);
  const canonicalUrl = new URL(pathname, "https://kagami.example.com").toString();
  return `<!doctype html><html><head>
    <title>${metadata.title}</title>
    <meta name="description" content="${metadata.description}" />
    <meta name="robots" content="${metadata.robots}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:title" content="${metadata.title}" />
    <meta property="og:description" content="${metadata.description}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="https://kagami.example.com/images/service/banner.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
  </head></html>`;
}

const privateRoutes = [
  "/app",
  "/diagnosis",
  "/me",
  "/compatibility",
  "/profile",
  "/admin",
] as const;

function deployedFetch(options?: {
  omitCanonicalAt?: string;
  omitPrivateHeader?: boolean;
  publicNoindexAt?: string;
}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input.toString());
    if (privateRoutes.some((route) => url.pathname === route)) {
      return new Response("<!doctype html>", {
        headers: {
          "Content-Type": "text/html",
          ...(options?.omitPrivateHeader ? {} : { "X-Robots-Tag": "noindex, nofollow" }),
        },
      });
    }

    const document = publicDocument(url.pathname);
    return new Response(
      options?.omitCanonicalAt === url.pathname
        ? document.replace(/\s*<link rel="canonical"[^>]+>/u, "")
        : document,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...(options?.publicNoindexAt === url.pathname
            ? { "X-Robots-Tag": "noindex, nofollow" }
            : {}),
        },
      },
    );
  });
}

describe("verifyServiceSiteDeployment", () => {
  it("非JSの公開metadataと本人向けrouteのnoindex headerを検証する", async () => {
    const fetcher = deployedFetch();

    await expect(
      verifyServiceSiteDeployment({
        baseDomain: "kagami.example.com",
        fetcher,
        attempts: 1,
      }),
    ).resolves.toEqual({
      checks: [
        "public-document-metadata",
        "public-route-robots-boundary",
        "private-route-noindex-header",
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(
      Object.keys(serviceSitePageMetadata).length + privateRoutes.length,
    );
  });

  it("画面固有canonicalが欠けたdeployを失敗させる", async () => {
    await expect(
      verifyServiceSiteDeployment({
        baseDomain: "https://kagami.example.com",
        fetcher: deployedFetch({ omitCanonicalAt: "/terms" }),
        attempts: 1,
      }),
    ).rejects.toThrow('Service site metadata is incomplete (/terms: rel="canonical")');
  });

  it("本人向けrouteのHTTP noindex境界が欠けたdeployを失敗させる", async () => {
    await expect(
      verifyServiceSiteDeployment({
        baseDomain: "https://kagami.example.com",
        fetcher: deployedFetch({ omitPrivateHeader: true }),
        attempts: 1,
      }),
    ).rejects.toThrow("Private route is missing an X-Robots-Tag noindex boundary (/app)");
  });

  it("公開routeへHTTP noindexが付いたdeployを失敗させる", async () => {
    await expect(
      verifyServiceSiteDeployment({
        baseDomain: "https://kagami.example.com",
        fetcher: deployedFetch({ publicNoindexAt: "/" }),
        attempts: 1,
      }),
    ).rejects.toThrow("Public route has a conflicting X-Robots-Tag boundary (/)");
  });

  it("custom domainへのdeployment反映が遅れた場合は検証をretryする", async () => {
    const deployed = deployedFetch();
    const fetcher = vi.fn<typeof fetch>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fetcher.mockRejectedValueOnce(new TypeError("UnexpectedRedirect"));
    }
    fetcher.mockImplementation(deployed);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyServiceSiteDeployment({
        baseDomain: "kagami.example.com",
        fetcher,
        retryIntervalMs: 2_000,
        sleep,
      }),
    ).resolves.toEqual({
      checks: [
        "public-document-metadata",
        "public-route-robots-boundary",
        "private-route-noindex-header",
      ],
    });
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });
});
