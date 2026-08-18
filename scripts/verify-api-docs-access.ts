/**
 * デプロイ済みのOpenAPI documentが未認証requestへ公開されていないことを確認します。
 *
 *   bun scripts/verify-api-docs-access.ts <preview|production>
 *
 * 必要な環境変数:
 *   - BASE_DOMAIN
 */

import { resolveApiHostname } from "./setup-api-docs-access";

export interface VerifyApiDocsAccessParams {
  baseDomain: string;
  fetch?: typeof globalThis.fetch;
}

export async function verifyApiDocsAccess(params: VerifyApiDocsAccessParams): Promise<void> {
  const hostname = resolveApiHostname(params.baseDomain);
  const fetchImpl = params.fetch ?? globalThis.fetch;
  for (const path of ["/api/openapi.json", "/api/docs", "/api/docs/index.html"]) {
    const url = `https://${hostname}${path}`;
    const response = await fetchImpl(url, { redirect: "manual" });

    if (response.status === 401 || response.status === 403) continue;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location && new URL(location, url).pathname.startsWith("/cdn-cgi/access/")) continue;
    }

    throw new Error(
      `API documentation is not protected by Cloudflare Access (${response.status} from ${url})`,
    );
  }
}

async function main(): Promise<void> {
  const environment = process.argv[2];
  if (environment !== "preview" && environment !== "production") {
    throw new Error("Usage: bun scripts/verify-api-docs-access.ts <preview|production>");
  }
  const baseDomain = process.env.BASE_DOMAIN?.trim();
  if (!baseDomain) throw new Error("BASE_DOMAIN is required");
  await verifyApiDocsAccess({ baseDomain });
  console.info(`Cloudflare Access denied an unauthenticated OpenAPI request (${environment})`);
}

if (import.meta.main) await main();
