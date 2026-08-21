import { D1 } from "@me-builder/lib";
import { createOpaqueCredential, hmacSha256Hex, sha256Base64Url } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  McpAuditResponseSchema,
  McpAuthorizationDecisionResponseSchema,
  McpAuthorizationDecisionSchema,
  McpAuthorizationRequestResponseSchema,
  McpConnectionsResponseSchema,
} from "../contract/mcp";
import { fetchAndVerifyClientMetadata, validateAuthorizationQuery } from "../logic/mcp-oauth";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function runtime(c: Context<AppEnv>) {
  const config = getConfig(c.env);
  const secret = c.env.MCP_TOKEN_HMAC_SECRET?.trim();
  if (!c.env.DB || !config.baseUrl || !config.webOrigin || !config.mcpResourceUrl || !secret) {
    return undefined;
  }
  return {
    db: D1.shared.client.create(c.env.DB),
    issuer: config.baseUrl.replace(/\/$/, ""),
    webOrigin: config.webOrigin.replace(/\/$/, ""),
    resource: config.mcpResourceUrl,
    secret,
    enabled: config.mcpFeatureEnabled,
  };
}

function oauthError(c: Context<AppEnv>, error: string, status: 400 | 401 | 503 = 400) {
  c.header("Cache-Control", "no-store");
  return c.json({ error }, status);
}

export async function getMcpAuthorization(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const query = validateAuthorizationQuery(new URL(c.req.url), current.resource);
  if (!query) return oauthError(c, "invalid_request");
  const metadata = await fetchAndVerifyClientMetadata(query.clientId);
  if (!metadata || !metadata.redirectUris.includes(query.redirectUri)) {
    return oauthError(c, "invalid_client");
  }
  const request = await D1.shared.action.mcp.createAuthorizationRequest(current.db, {
    accountId: authenticatedActor(c).accountId,
    clientId: metadata.clientId,
    clientName: metadata.clientName,
    metadataHash: metadata.metadataHash,
    redirectUri: query.redirectUri,
    ...(query.state ? { state: query.state } : {}),
    codeChallenge: query.codeChallenge,
    resource: current.resource,
  });
  c.header("Cache-Control", "no-store");
  return c.redirect(`${current.webOrigin}/mcp/authorize?request=${encodeURIComponent(request.id)}`);
}

export async function getMcpAuthorizationRequest(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const request = await D1.shared.action.mcp.findAuthorizationRequest(
    current.db,
    authenticatedActor(c).accountId,
    c.req.param("requestId") ?? "",
  );
  if (!request) return c.json({ error: "Not Found" } as const, 404);
  c.header("Cache-Control", "no-store");
  return c.json(
    v.parse(McpAuthorizationRequestResponseSchema, {
      id: request.id,
      clientName: request.clientName,
      clientId: request.clientId,
      scope: "brain:search",
      accessProfile: "owner",
      expiresAt: request.expiresAt.toISOString(),
    }),
  );
}

export async function postMcpAuthorizationDecision(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const body = v.safeParse(McpAuthorizationDecisionSchema, await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid request" } as const, 400);
  const request = await D1.shared.action.mcp.findAuthorizationRequest(
    current.db,
    authenticatedActor(c).accountId,
    c.req.param("requestId") ?? "",
  );
  if (!request) return c.json({ error: "Not Found" } as const, 404);
  if (!body.output.allow) {
    const rejected = await D1.shared.action.mcp.rejectAuthorizationRequest(
      current.db,
      authenticatedActor(c).accountId,
      request.id,
    );
    if (!rejected) return c.json({ error: "Not Found" } as const, 404);
    const denied = new URL(request.redirectUri);
    denied.searchParams.set("error", "access_denied");
    if (request.state) denied.searchParams.set("state", request.state);
    return c.json(v.parse(McpAuthorizationDecisionResponseSchema, { redirectUrl: denied.href }));
  }
  const code = createOpaqueCredential();
  const approved = await D1.shared.action.mcp.approveAuthorizationRequest(
    current.db,
    authenticatedActor(c).accountId,
    request.id,
    await hmacSha256Hex(current.secret, "authorization-code", code),
  );
  if (!approved) return c.json({ error: "Not Found" } as const, 404);
  const redirect = new URL(approved.redirectUri);
  redirect.searchParams.set("code", code);
  if (approved.state) redirect.searchParams.set("state", approved.state);
  return c.json(v.parse(McpAuthorizationDecisionResponseSchema, { redirectUrl: redirect.href }));
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: D1.shared.action.mcp.MCP_ACCESS_TOKEN_TTL_MS / 1_000,
    refresh_token: refreshToken,
    scope: D1.shared.action.mcp.MCP_SCOPE,
  } as const;
}

function sendTokenResponse(c: Context<AppEnv>, accessToken: string, refreshToken: string) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json(tokenResponse(accessToken, refreshToken));
}

export async function postMcpToken(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const form = await c.req.parseBody();
  const grantType = String(form.grant_type ?? "");
  const clientId = String(form.client_id ?? "");
  if (!clientId) return oauthError(c, "invalid_client", 401);
  const accessToken = createOpaqueCredential();
  const refreshToken = createOpaqueCredential();
  const hashes = {
    accessTokenHash: await hmacSha256Hex(current.secret, "access-token", accessToken),
    refreshTokenHash: await hmacSha256Hex(current.secret, "refresh-token", refreshToken),
  };
  if (grantType === "authorization_code") {
    const code = String(form.code ?? "");
    const verifier = String(form.code_verifier ?? "");
    const redirectUri = String(form.redirect_uri ?? "");
    const resource = String(form.resource ?? "");
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return oauthError(c, "invalid_grant");
    }
    const issued = await D1.shared.action.mcp.exchangeAuthorizationCode(current.db, {
      codeHash: await hmacSha256Hex(current.secret, "authorization-code", code),
      clientId,
      redirectUri,
      resource,
      codeChallenge: await sha256Base64Url(verifier),
      tokens: hashes,
    });
    if (!issued) return oauthError(c, "invalid_grant");
    return sendTokenResponse(c, accessToken, refreshToken);
  }
  if (grantType === "refresh_token") {
    const rawRefreshToken = String(form.refresh_token ?? "");
    const refreshTokenHash = await hmacSha256Hex(current.secret, "refresh-token", rawRefreshToken);
    const tokenContext = await D1.shared.action.mcp.findRefreshTokenAccount(
      current.db,
      refreshTokenHash,
      clientId,
    );
    const terms = tokenContext
      ? await D1.shared.action.agreement.hasAcceptedCurrentTerms(
          current.db,
          tokenContext.account.id,
        )
      : false;
    if (!tokenContext || !terms) return oauthError(c, "invalid_grant");
    const rotated = await D1.shared.action.mcp.rotateRefreshToken(current.db, {
      refreshTokenHash,
      clientId,
      tokens: hashes,
    });
    if (rotated.type !== "rotated") return oauthError(c, "invalid_grant");
    return sendTokenResponse(c, accessToken, refreshToken);
  }
  return oauthError(c, "unsupported_grant_type");
}

export async function getMcpConnections(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  const connections = await D1.shared.action.mcp.listConnections(
    current.db,
    authenticatedActor(c).accountId,
  );
  c.header("Cache-Control", "no-store");
  return c.json(
    v.parse(McpConnectionsResponseSchema, {
      connections: connections.map((item) => ({
        ...item,
        authorizedAt: item.authorizedAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
        revokedAt: item.revokedAt?.toISOString() ?? null,
      })),
    }),
  );
}

export async function deleteMcpConnection(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  const revoked = await D1.shared.action.mcp.revokeConnection(
    current.db,
    authenticatedActor(c).accountId,
    c.req.param("connectionId") ?? "",
  );
  return revoked ? c.body(null, 204) : c.json({ error: "Not Found" } as const, 404);
}

export async function getMcpAudit(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  await D1.shared.action.mcp.pruneAuditRecords(current.db);
  const records = await D1.shared.action.mcp.listAuditRecords(
    current.db,
    authenticatedActor(c).accountId,
  );
  c.header("Cache-Control", "no-store");
  return c.json(
    v.parse(McpAuditResponseSchema, {
      records: records.map((record) => ({
        id: record.id,
        connectionId: record.connectionId,
        clientName: record.clientName,
        outcome: record.outcome,
        reasonCode: record.reasonCode,
        resultCount: record.resultCount,
        brainItemIds: record.brainItemIds,
        occurredAt: record.occurredAt.toISOString(),
      })),
    }),
  );
}

export function getOAuthAuthorizationServerMetadata(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current) return oauthError(c, "temporarily_unavailable", 503);
  c.header("Cache-Control", "no-store");
  return c.json({
    issuer: current.issuer,
    authorization_endpoint: `${current.issuer}/api/mcp/oauth/authorize`,
    token_endpoint: `${current.issuer}/api/mcp/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["brain:search"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
  });
}
