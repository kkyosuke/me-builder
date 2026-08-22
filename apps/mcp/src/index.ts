import type { D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { type AccountDataNamespace, D1 } from "@me-builder/lib";
import {
  type SafeOperationalErrorFields,
  describeHttpResult,
  hmacSha256Hex,
  httpOutcome,
  logger,
  operationalLogLevel,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import {
  McpServer,
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";
import { searchMyBrain } from "./brain-search";
import { config, getMcpConfig } from "./config";

type McpBindings = {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  WEB_ORIGIN?: string;
  MCP_FEATURE_ENABLED?: string;
  GOOGLE_VERTEX_AI_API_KEY?: string;
  GEMINI_EMBEDDING_MODEL?: string;
  BRAIN_VECTOR_HMAC_SECRET?: string;
  MCP_TOKEN_HMAC_SECRET?: string;
  DB?: D1Database;
  ACCOUNT_DATA?: AccountDataNamespace;
  BRAIN_VECTOR_INDEX?: VectorizeIndex;
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

type AuthorizedMcp = {
  accountId: string;
  connectionId: string;
  clientId: string;
  clientName: string;
};
type AuthorizedMcpContext = AuthorizedMcp & { env: McpBindings };

const app = new Hono<{
  Bindings: McpBindings;
  Variables: { safeError?: SafeOperationalErrorFields };
}>();

app.onError((err, c) => {
  c.set(
    "safeError",
    toSafeOperationalErrorFields(err, {
      code: "UNEXPECTED_MCP_ERROR",
      category: "unknown",
      stage: "http.handle",
      retryable: false,
    }),
  );
  return c.json({ error: "Internal Server Error" }, 500);
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const responseTimeMs = Date.now() - start;
  const status = c.res.status;
  const safeError = c.get("safeError");
  const outcome = httpOutcome(status);
  const fields = {
    event: outcome === "failed" ? "http.request.failed" : "http.request.completed",
    service: "mcp",
    method: c.req.method,
    path: c.req.path,
    status,
    outcome,
    responseTimeMs,
    ...(safeError ?? {}),
  };
  const description = describeHttpResult({
    service: "MCP",
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: responseTimeMs,
    ...(safeError ? { errorCode: safeError.errorCode } : {}),
  });
  const level = operationalLogLevel(outcome);
  if (level === "error") logger.error(fields, description);
  else if (level === "info") logger.info(fields, description);
  else logger.warn(fields, description);
});

app.get("/health", (c) => {
  const currentConfig = getMcpConfig(c.env);
  return c.json({
    service: "me-builder MCP Server",
    status: "ok",
    environment: currentConfig.environment,
    timestamp: new Date().toISOString(),
  });
});

const unavailable = {
  error: "Not Implemented",
  code: "MCP_NOT_AVAILABLE",
  phase: "phase_2",
} as const;

function urls(env: McpBindings) {
  const current = getMcpConfig(env);
  if (!current.baseUrl || !current.apiUrl) return undefined;
  return {
    resource: new URL("/mcp", current.baseUrl),
    issuer: current.apiUrl.replace(/\/$/, ""),
  };
}

app.get("/.well-known/oauth-protected-resource/mcp", (c) => {
  const current = urls(c.env);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  c.header("Cache-Control", "no-store");
  return c.json(
    buildOAuthProtectedResourceMetadata({
      resourceServerUrl: current.resource,
      oauthMetadata: {
        issuer: current.issuer,
        authorization_endpoint: `${current.issuer}/api/mcp/oauth/authorize`,
        token_endpoint: `${current.issuer}/api/mcp/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      },
      scopesSupported: ["brain:search"],
      resourceName: "Kagami Brain",
    }),
  );
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  const current = urls(c.env);
  if (!current) return c.json({ error: "Service Unavailable" } as const, 503);
  c.header("Cache-Control", "no-store");
  return c.redirect(`${current.issuer}/.well-known/oauth-authorization-server`, 302);
});

const mcpHandler = createMcpHandler(
  () => {
    const server = new McpServer({ name: "me-builder", version: "1.0.0" });
    server.registerTool(
      "search_my_brain",
      {
        title: "Search my Brain",
        description: "管理者本人が外部提供を許可したBrain Itemだけを意味検索します。",
        inputSchema: z.object({ query: z.string().trim().min(1).max(500) }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async ({ query }, context) => {
        const authorized = context.http?.authInfo?.extra as AuthorizedMcpContext | undefined;
        if (!authorized?.env) throw new Error("MCP authorization context missing");
        const { env: currentEnv, ...currentIdentity } = authorized;
        const controller = new AbortController();
        const abort = () => controller.abort(context.mcpReq.signal.reason);
        if (context.mcpReq.signal.aborted) abort();
        else context.mcpReq.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(
          () => controller.abort(new Error("MCP request timed out")),
          30_000,
        );
        try {
          const results = await searchMyBrain(
            currentEnv as never,
            currentIdentity,
            query,
            controller.signal,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ results }) }],
            structuredContent: { results },
          };
        } finally {
          clearTimeout(timeout);
          context.mcpReq.signal.removeEventListener("abort", abort);
        }
      },
    );
    return server;
  },
  { legacy: "reject", responseMode: "json" },
);

app.post("/mcp", async (c) => {
  c.header("Cache-Control", "no-store");
  const currentConfig = getMcpConfig(c.env);
  if (!currentConfig.featureEnabled) return c.json(unavailable, 501);
  const currentUrls = urls(c.env);
  const origin = c.req.header("Origin");
  if (currentUrls && origin && origin !== currentUrls.resource.origin) {
    return c.json({ error: "Forbidden" } as const, 403);
  }
  const dbBinding = c.env.DB;
  const tokenSecret = currentConfig.tokenHmacSecret;
  if (
    !currentUrls ||
    !dbBinding ||
    !c.env.ACCOUNT_DATA ||
    !c.env.BRAIN_VECTOR_INDEX ||
    !currentConfig.googleVertexAiApiKey ||
    !currentConfig.brainVectorHmacSecret ||
    !tokenSecret
  ) {
    return c.json({ error: "Service Unavailable" } as const, 503);
  }
  const authorization = c.req.header("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization);
  if (!match?.[1]) {
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(currentUrls.resource)}"`,
    );
    return c.json({ error: "Unauthorized" } as const, 401);
  }
  const db = D1.shared.client.create(dbBinding);
  const verified = await D1.shared.action.mcp.verifyAccessToken(
    db,
    await hmacSha256Hex(tokenSecret, "access-token", match[1]),
    currentUrls.resource.href,
  );
  if (!verified) {
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(currentUrls.resource)}", error="invalid_token"`,
    );
    return c.json({ error: "Unauthorized" } as const, 401);
  }
  const termsAccepted = await D1.shared.action.agreement.hasAcceptedCurrentTerms(
    db,
    verified.account.id,
  );
  if (!termsAccepted || verified.token.scope !== "brain:search") {
    await D1.shared.action.mcp.recordAudit(db, {
      accountId: verified.account.id,
      connectionId: verified.connection.id,
      clientId: verified.connection.clientId,
      clientName: verified.connection.clientName,
      outcome: "refused",
      reasonCode: termsAccepted ? "SCOPE_REFUSED" : "TERMS_NOT_ACCEPTED",
    });
    return c.json({ error: "Forbidden" } as const, 403);
  }
  await D1.shared.action.mcp.touchConnection(db, verified.connection.id);
  const identity = {
    accountId: verified.account.id,
    connectionId: verified.connection.id,
    clientId: verified.connection.clientId,
    clientName: verified.connection.clientName,
  };
  const response = await mcpHandler.fetch(c.req.raw, {
    authInfo: {
      token: match[1],
      clientId: verified.connection.clientId,
      scopes: ["brain:search"],
      expiresAt: Math.floor(verified.token.expiresAt.getTime() / 1_000),
      resource: currentUrls.resource,
      extra: { ...identity, env: c.env },
    },
  });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});

app.get("/sse", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(unavailable, 501);
});
app.post("/messages", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(unavailable, 501);
});

logger.info(`MCP Server is running on http://localhost:${config.port}`);

export { app };
export default { port: config.port, fetch: app.fetch };
