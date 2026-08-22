import { getEnv } from "@me-builder/shared";
import * as v from "valibot";
import { type McpConfig, McpConfigSchema } from "./schema";

export { McpConfigSchema, type McpConfig };

/**
 * MCP サーバーの環境変数を取得・整理し、Valibot で検証・整形した設定オブジェクトを生成します。
 * Hono の c.env や process.env から値を取得します。
 */
export function getMcpConfig(env?: Record<string, unknown>): McpConfig {
  const rawEnvironment = getEnv(["ENVIRONMENT", "NODE_ENV"], env);
  const rawPort = getEnv(["MCP_PORT", "PORT"], env);
  const rawBaseDomain = getEnv("BASE_DOMAIN", env);
  const rawWebOrigin = getEnv("WEB_ORIGIN", env)?.trim() || undefined;
  let rawBaseUrl = getEnv("BASE_URL", env);
  let rawApiUrl = getEnv("API_URL", env);

  if ((!rawBaseUrl || rawBaseUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("mcp.")
        ? `https://${rawBaseDomain}`
        : `https://mcp.${rawBaseDomain}`;
    rawBaseUrl = domain;
  }

  if ((!rawApiUrl || rawApiUrl === "/") && rawBaseDomain) {
    const domain = rawBaseDomain.startsWith("http")
      ? rawBaseDomain
      : rawBaseDomain.startsWith("api.")
        ? `https://${rawBaseDomain}`
        : `https://api.${rawBaseDomain}`;
    rawApiUrl = domain;
  }

  const rawConfig = {
    port: rawPort,
    environment: rawEnvironment,
    baseDomain: rawBaseDomain,
    baseUrl: rawBaseUrl,
    apiUrl: rawApiUrl,
    webOrigin: rawWebOrigin,
    featureEnabled: getEnv("MCP_FEATURE_ENABLED", env)?.trim() === "true",
    googleVertexAiApiKey: getEnv("GOOGLE_VERTEX_AI_API_KEY", env)?.trim() || undefined,
    geminiEmbeddingModel: getEnv("GEMINI_EMBEDDING_MODEL", env)?.trim() || "gemini-embedding-001",
    brainVectorHmacSecret: getEnv("BRAIN_VECTOR_HMAC_SECRET", env)?.trim() || undefined,
    tokenHmacSecret: getEnv("MCP_TOKEN_HMAC_SECRET", env)?.trim() || undefined,
  };

  return v.parse(McpConfigSchema, rawConfig);
}

export const config = getMcpConfig();
