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
  /** ブラウザからのCORSリクエストを許可するWeb UIのオリジン。 */
  webOrigin: v.optional(v.pipe(v.string(), v.url())),
});

export type McpConfig = v.InferOutput<typeof McpConfigSchema>;
