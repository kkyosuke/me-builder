import { readFile, writeFile } from "node:fs/promises";
import { serviceSitePageMetadata } from "../src/feature/service-site/model/service-site-page-metadata";

type Metadata = (typeof serviceSitePageMetadata)[keyof typeof serviceSitePageMetadata];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function configuredBaseUrl(): string | undefined {
  const raw = process.env.VITE_BASE_DOMAIN ?? process.env.BASE_DOMAIN;
  if (!raw) return undefined;
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

export function renderServiceSiteDocument(
  source: string,
  metadata: Metadata,
  baseUrl?: string,
): string {
  const canonicalUrl = baseUrl ? new URL(metadata.pathname, baseUrl).toString() : undefined;
  const shareImageUrl = baseUrl
    ? new URL("/images/service/banner.jpg", baseUrl).toString()
    : undefined;
  const tags = [
    `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
    `<meta name="robots" content="${metadata.robots}" />`,
    canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />` : undefined,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="ja_JP" />`,
    `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
    canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />` : undefined,
    shareImageUrl
      ? `<meta property="og:image" content="${escapeHtml(shareImageUrl)}" />`
      : undefined,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ]
    .filter((tag): tag is string => Boolean(tag))
    .map((tag) => `    ${tag}`)
    .join("\n");

  return source
    .replace(/<title>.*?<\/title>/u, `<title>${escapeHtml(metadata.title)}</title>`)
    .replace("  </head>", `${tags}\n  </head>`);
}

export function serviceSiteEntrypointFilename(pathname: string): string {
  if (pathname === "/") return "index.html";
  return `${pathname.replace(/^\/+|\/+$/g, "")}.html`;
}

async function generateEntryPoints(): Promise<void> {
  const distUrl = new URL("../dist/", import.meta.url);
  const source = await readFile(new URL("index.html", distUrl), "utf8");
  const baseUrl = configuredBaseUrl();

  for (const metadata of Object.values(serviceSitePageMetadata)) {
    const document = renderServiceSiteDocument(source, metadata, baseUrl);
    await writeFile(new URL(serviceSiteEntrypointFilename(metadata.pathname), distUrl), document);
  }
}

if (import.meta.main) await generateEntryPoints();
