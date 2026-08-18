import { serviceSitePageMetadata } from "../apps/web/src/feature/service-site/model/service-site-page-metadata";

type VerificationInput = Readonly<{
  baseDomain: string;
  fetcher?: typeof fetch;
  attempts?: number;
  retryIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

const PRIVATE_ROUTES = ["/app", "/admin"] as const;

export async function verifyServiceSiteDeployment(
  input: VerificationInput,
): Promise<Readonly<{ checks: string[] }>> {
  const origin = secureOrigin(input.baseDomain);
  const fetcher = input.fetcher ?? fetch;
  const attempts = input.attempts ?? 5;
  const retryIntervalMs = input.retryIntervalMs ?? 2_000;
  const sleep =
    input.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await verifyPublicDocuments(fetcher, origin);
      await verifyPrivateRouteHeaders(fetcher, origin);
      return { checks: ["public-document-metadata", "private-route-noindex-header"] };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryIntervalMs);
    }
  }

  throw lastError;
}

async function verifyPublicDocuments(fetcher: typeof fetch, origin: string): Promise<void> {
  for (const metadata of Object.values(serviceSitePageMetadata)) {
    const url = new URL(metadata.pathname, origin);
    const response = await fetcher(url, { redirect: "error" });
    expectHtmlResponse(response, url);
    const document = await response.text();
    const canonicalUrl = url.toString();
    const shareImageUrl = new URL("/images/service/banner.jpg", origin).toString();

    expectDocumentValue(document, `<title>${escapeHtml(metadata.title)}</title>`, url);
    expectDocumentValue(
      document,
      `name="description" content="${escapeHtml(metadata.description)}"`,
      url,
    );
    expectDocumentValue(document, `name="robots" content="${metadata.robots}"`, url);
    expectDocumentValue(document, `rel="canonical" href="${canonicalUrl}"`, url);
    expectDocumentValue(
      document,
      `property="og:title" content="${escapeHtml(metadata.title)}"`,
      url,
    );
    expectDocumentValue(
      document,
      `property="og:description" content="${escapeHtml(metadata.description)}"`,
      url,
    );
    expectDocumentValue(document, `property="og:url" content="${canonicalUrl}"`, url);
    expectDocumentValue(document, `property="og:image" content="${shareImageUrl}"`, url);
    expectDocumentValue(document, 'name="twitter:card" content="summary_large_image"', url);
  }
}

async function verifyPrivateRouteHeaders(fetcher: typeof fetch, origin: string): Promise<void> {
  for (const pathname of PRIVATE_ROUTES) {
    const url = new URL(pathname, origin);
    const response = await fetcher(url, { redirect: "error" });
    expectHtmlResponse(response, url);
    const robots = (response.headers.get("x-robots-tag") ?? "").toLowerCase().replaceAll(/\s/g, "");
    if (!robots.includes("noindex") || !robots.includes("nofollow")) {
      throw new Error(
        `Private route is missing an X-Robots-Tag noindex boundary (${url.pathname})`,
      );
    }
  }
}

function expectHtmlResponse(response: Response, url: URL): void {
  if (!response.ok) {
    throw new Error(`Service site verification received HTTP ${response.status} (${url.pathname})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Service site verification expected HTML (${url.pathname})`);
  }
}

function expectDocumentValue(document: string, expected: string, url: URL): void {
  if (!document.includes(expected)) {
    throw new Error(
      `Service site metadata is incomplete (${url.pathname}: ${expected.split(" ")[0]})`,
    );
  }
}

function secureOrigin(baseDomain: string): string {
  const raw = baseDomain.trim();
  if (!raw) throw new Error("BASE_DOMAIN is required");
  const url = new URL(
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`,
  );
  if (url.protocol !== "https:") throw new Error("BASE_DOMAIN must use HTTPS");
  return url.origin;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main(): Promise<void> {
  const baseDomain = process.env.BASE_DOMAIN;
  if (!baseDomain) throw new Error("BASE_DOMAIN is required");
  const result = await verifyServiceSiteDeployment({ baseDomain });
  console.info(`Service site deployment verified (${result.checks.join(", ")})`);
}

if (import.meta.main) await main();
