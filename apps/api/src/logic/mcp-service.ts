import { D1 } from "@me-builder/lib";
import { createOpaqueCredential, hmacSha256Hex, sha256Base64Url } from "@me-builder/shared";
import { fetchAndVerifyClientMetadata, validateAuthorizationQuery } from "./mcp-oauth";

export type McpServiceContext = Readonly<{
  db: D1.shared.Client;
  webOrigin: string;
  resource: string;
  secret: string;
}>;

export async function beginMcpAuthorization(
  context: McpServiceContext,
  accountId: string,
  requestUrl: URL,
) {
  const query = validateAuthorizationQuery(requestUrl, context.resource);
  if (!query) return { type: "invalid-request" } as const;
  const metadata = await fetchAndVerifyClientMetadata(query.clientId);
  if (!metadata || !metadata.redirectUris.includes(query.redirectUri)) {
    return { type: "invalid-client" } as const;
  }
  const request = await D1.shared.action.mcp.createAuthorizationRequest(context.db, {
    accountId,
    clientId: metadata.clientId,
    clientName: metadata.clientName,
    metadataHash: metadata.metadataHash,
    redirectUri: query.redirectUri,
    ...(query.state ? { state: query.state } : {}),
    codeChallenge: query.codeChallenge,
    resource: context.resource,
  });
  return {
    type: "created",
    redirectUrl: `${context.webOrigin}/mcp/authorize?request=${encodeURIComponent(request.id)}`,
  } as const;
}

export async function findMcpAuthorizationRequest(
  context: McpServiceContext,
  accountId: string,
  requestId: string,
) {
  return D1.shared.action.mcp.findAuthorizationRequest(context.db, accountId, requestId);
}

export async function decideMcpAuthorization(
  context: McpServiceContext,
  accountId: string,
  requestId: string,
  allow: boolean,
) {
  const request = await findMcpAuthorizationRequest(context, accountId, requestId);
  if (!request) return { type: "not-found" } as const;
  if (!allow) {
    const rejected = await D1.shared.action.mcp.rejectAuthorizationRequest(
      context.db,
      accountId,
      request.id,
    );
    if (!rejected) return { type: "not-found" } as const;
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    if (request.state) redirect.searchParams.set("state", request.state);
    return { type: "decided", redirectUrl: redirect.href } as const;
  }
  const code = createOpaqueCredential();
  const approved = await D1.shared.action.mcp.approveAuthorizationRequest(
    context.db,
    accountId,
    request.id,
    await hmacSha256Hex(context.secret, "authorization-code", code),
  );
  if (!approved) return { type: "not-found" } as const;
  const redirect = new URL(approved.redirectUri);
  redirect.searchParams.set("code", code);
  if (approved.state) redirect.searchParams.set("state", approved.state);
  return { type: "decided", redirectUrl: redirect.href } as const;
}

type McpTokenForm = Readonly<Record<string, string>>;

export async function issueMcpTokens(context: McpServiceContext, form: McpTokenForm) {
  const grantType = form.grant_type ?? "";
  const clientId = form.client_id ?? "";
  if (!clientId) return { type: "error", error: "invalid_client", status: 401 } as const;
  const accessToken = createOpaqueCredential();
  const refreshToken = createOpaqueCredential();
  const hashes = {
    accessTokenHash: await hmacSha256Hex(context.secret, "access-token", accessToken),
    refreshTokenHash: await hmacSha256Hex(context.secret, "refresh-token", refreshToken),
  };
  if (grantType === "authorization_code") {
    const code = form.code ?? "";
    const verifier = form.code_verifier ?? "";
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return { type: "error", error: "invalid_grant", status: 400 } as const;
    }
    const issued = await D1.shared.action.mcp.exchangeAuthorizationCode(context.db, {
      codeHash: await hmacSha256Hex(context.secret, "authorization-code", code),
      clientId,
      redirectUri: form.redirect_uri ?? "",
      resource: form.resource ?? "",
      codeChallenge: await sha256Base64Url(verifier),
      tokens: hashes,
    });
    if (!issued) return { type: "error", error: "invalid_grant", status: 400 } as const;
    return { type: "issued", accessToken, refreshToken } as const;
  }
  if (grantType === "refresh_token") {
    const refreshTokenHash = await hmacSha256Hex(
      context.secret,
      "refresh-token",
      form.refresh_token ?? "",
    );
    const tokenContext = await D1.shared.action.mcp.findRefreshTokenAccount(
      context.db,
      refreshTokenHash,
      clientId,
    );
    const terms = tokenContext
      ? await D1.shared.action.agreement.hasAcceptedCurrentTerms(
          context.db,
          tokenContext.account.id,
        )
      : false;
    if (!tokenContext || !terms) {
      return { type: "error", error: "invalid_grant", status: 400 } as const;
    }
    const rotated = await D1.shared.action.mcp.rotateRefreshToken(context.db, {
      refreshTokenHash,
      clientId,
      tokens: hashes,
    });
    if (rotated.type !== "rotated") {
      return { type: "error", error: "invalid_grant", status: 400 } as const;
    }
    return { type: "issued", accessToken, refreshToken } as const;
  }
  return { type: "error", error: "unsupported_grant_type", status: 400 } as const;
}

export function listMcpConnections(context: McpServiceContext, accountId: string) {
  return D1.shared.action.mcp.listConnections(context.db, accountId);
}

export function revokeMcpConnection(
  context: McpServiceContext,
  accountId: string,
  connectionId: string,
) {
  return D1.shared.action.mcp.revokeConnection(context.db, accountId, connectionId);
}

export async function listMcpAuditRecords(context: McpServiceContext, accountId: string) {
  await D1.shared.action.mcp.pruneAuditRecords(context.db);
  return D1.shared.action.mcp.listAuditRecords(context.db, accountId);
}

export const mcpTokenContract = {
  expiresIn: D1.shared.action.mcp.MCP_ACCESS_TOKEN_TTL_MS / 1_000,
  scope: D1.shared.action.mcp.MCP_SCOPE,
} as const;
