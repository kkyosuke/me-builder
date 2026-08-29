import { D1 } from "@me-builder/lib";
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
import {
  beginMcpAuthorization,
  decideMcpAuthorization,
  findMcpAuthorizationRequest,
  issueMcpTokens,
  listMcpAuditRecords,
  listMcpConnections,
  mcpTokenContract,
  revokeMcpConnection,
} from "../logic/mcp-service";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function runtime(c: Context<AppEnv>) {
  const config = getConfig(c.env);
  const secret = c.env.MCP_TOKEN_HMAC_SECRET?.trim();
  if (!c.env.DB || !config.baseUrl || !config.webOrigin || !config.mcpResourceUrl || !secret) {
    return undefined;
  }
  return {
    service: {
      db: D1.shared.client.create(c.env.DB),
      webOrigin: config.webOrigin.replace(/\/$/, ""),
      resource: config.mcpResourceUrl,
      secret,
    },
    issuer: config.baseUrl.replace(/\/$/, ""),
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
  const result = await beginMcpAuthorization(
    current.service,
    authenticatedActor(c).accountId,
    new URL(c.req.url),
  );
  if (result.type === "invalid-request") return oauthError(c, "invalid_request");
  if (result.type === "invalid-client") return oauthError(c, "invalid_client");
  c.header("Cache-Control", "no-store");
  return c.redirect(result.redirectUrl);
}

export async function getMcpAuthorizationRequest(c: Context<AppEnv>) {
  c.header("Cache-Control", "no-store");
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const request = await findMcpAuthorizationRequest(
    current.service,
    authenticatedActor(c).accountId,
    c.req.param("requestId") ?? "",
  );
  if (!request) return c.json({ error: "Not Found" } as const, 404);
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
  c.header("Cache-Control", "no-store");
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const body = v.safeParse(McpAuthorizationDecisionSchema, await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid request" } as const, 400);
  const result = await decideMcpAuthorization(
    current.service,
    authenticatedActor(c).accountId,
    c.req.param("requestId") ?? "",
    body.output.allow,
  );
  if (result.type === "not-found") return c.json({ error: "Not Found" } as const, 404);
  return c.json(
    v.parse(McpAuthorizationDecisionResponseSchema, { redirectUrl: result.redirectUrl }),
  );
}

function sendTokenResponse(c: Context<AppEnv>, accessToken: string, refreshToken: string) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: mcpTokenContract.expiresIn,
    refresh_token: refreshToken,
    scope: mcpTokenContract.scope,
  } as const);
}

export async function postMcpToken(c: Context<AppEnv>) {
  const current = runtime(c);
  if (!current?.enabled) return oauthError(c, "temporarily_unavailable", 503);
  const parsed = await c.req.parseBody();
  const form = Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  );
  const result = await issueMcpTokens(current.service, form);
  if (result.type === "error") return oauthError(c, result.error, result.status);
  return sendTokenResponse(c, result.accessToken, result.refreshToken);
}

export async function getMcpConnections(c: Context<AppEnv>) {
  c.header("Cache-Control", "no-store");
  const current = runtime(c);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  const connections = await listMcpConnections(current.service, authenticatedActor(c).accountId);
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
  c.header("Cache-Control", "no-store");
  const current = runtime(c);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  const revoked = await revokeMcpConnection(
    current.service,
    authenticatedActor(c).accountId,
    c.req.param("connectionId") ?? "",
  );
  return revoked ? c.body(null, 204) : c.json({ error: "Not Found" } as const, 404);
}

export async function getMcpAudit(c: Context<AppEnv>) {
  c.header("Cache-Control", "no-store");
  const current = runtime(c);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  const records = await listMcpAuditRecords(current.service, authenticatedActor(c).accountId);
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
