import * as v from "valibot";

export const McpConfigSchema = v.object({
  port: v.pipe(
    v.optional(v.string(), "3001"),
    v.transform((val) => Number(val) || 3001),
  ),
  environment: v.optional(v.string(), "development"),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
});

export type McpConfig = v.InferOutput<typeof McpConfigSchema>;

/**
 * MCP サーバーの環境変数を取得・整理し、Valibot で検証・整形した設定オブジェクトを生成します。
 * Hono の c.env や process.env から値を取得します。
 */
export function getMcpConfig(env?: Record<string, string | undefined>): McpConfig {
  const getEnv = (key: string): string | undefined => {
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      return env[key];
    }
    return typeof process !== "undefined" ? process.env?.[key] : undefined;
  };

  const rawEnvironment = getEnv("ENVIRONMENT") || getEnv("NODE_ENV");
  const rawPort = getEnv("MCP_PORT") || getEnv("PORT");
  const rawBaseDomain = getEnv("BASE_DOMAIN");
  let rawBaseUrl = getEnv("BASE_URL");
  let rawApiUrl = getEnv("API_URL");

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
  };

  return v.parse(McpConfigSchema, rawConfig);
}

export const config = getMcpConfig();
