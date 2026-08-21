import { sha256Base64Url } from "@me-builder/shared";

const CIMD_MAX_BYTES = 32 * 1024;
const CIMD_TIMEOUT_MS = 3_000;

export type VerifiedClientMetadata = Readonly<{
  clientId: string;
  clientName: string;
  redirectUris: readonly string[];
  metadataHash: string;
}>;

function publicHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "0.0.0.0" ||
      hostname === "::" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("fe80:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd")
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function metadataFingerprint(input: {
  clientId: string;
  redirectUris: readonly string[];
}): Promise<string> {
  return sha256Base64Url(
    JSON.stringify({ client_id: input.clientId, redirect_uris: [...input.redirectUris].sort() }),
  );
}

export async function fetchAndVerifyClientMetadata(
  clientId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<VerifiedClientMetadata | undefined> {
  const url = publicHttpsUrl(clientId);
  if (!url) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CIMD_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get("Content-Length") ?? 0);
    if (!response.ok || response.status >= 300 || declaredLength > CIMD_MAX_BYTES) return undefined;
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > CIMD_MAX_BYTES) return undefined;
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
    const metadata = body as Record<string, unknown>;
    if (metadata.client_id !== clientId || typeof metadata.client_name !== "string")
      return undefined;
    if (
      (metadata.grant_types !== undefined &&
        (!Array.isArray(metadata.grant_types) ||
          !metadata.grant_types.includes("authorization_code") ||
          !metadata.grant_types.includes("refresh_token"))) ||
      (metadata.response_types !== undefined &&
        (!Array.isArray(metadata.response_types) || !metadata.response_types.includes("code"))) ||
      (metadata.token_endpoint_auth_method !== undefined &&
        metadata.token_endpoint_auth_method !== "none")
    ) {
      return undefined;
    }
    if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0)
      return undefined;
    const redirectUris = metadata.redirect_uris.flatMap((value) => {
      if (typeof value !== "string") return [];
      try {
        const redirect = new URL(value);
        if (redirect.username || redirect.password || redirect.hash) return [];
        if (redirect.protocol === "https:") return [value];
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
        return redirect.protocol === "http:" && loopback ? [value] : [];
      } catch {
        return [];
      }
    });
    if (redirectUris.length !== metadata.redirect_uris.length) return undefined;
    return {
      clientId,
      clientName: metadata.client_name.trim().slice(0, 120) || new URL(clientId).hostname,
      redirectUris,
      metadataHash: await metadataFingerprint({ clientId, redirectUris }),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function validateAuthorizationQuery(
  url: URL,
  resource: string,
):
  | Readonly<{
      clientId: string;
      redirectUri: string;
      state?: string;
      codeChallenge: string;
    }>
  | undefined {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const state = url.searchParams.get("state") ?? undefined;
  if (
    url.searchParams.get("response_type") !== "code" ||
    url.searchParams.get("scope") !== "brain:search" ||
    url.searchParams.get("resource") !== resource ||
    url.searchParams.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) ||
    !clientId ||
    !redirectUri ||
    (state !== undefined && state.length > 512)
  ) {
    return undefined;
  }
  return { clientId, redirectUri, codeChallenge, ...(state ? { state } : {}) };
}
