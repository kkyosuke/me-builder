import { getCloudflareEnv } from "./cloudflare";
import { getLocalEnv } from "./local";
import { type ApiConfig, ConfigSchema, type RawConfig, buildConfig, rawSchema } from "./schema";

export {
  ConfigSchema,
  rawSchema,
  type ApiConfig,
  type RawConfig,
  getLocalEnv,
  getCloudflareEnv,
  buildConfig,
};

/**
 * 環境変数を取得・整理し、Valibot で検証・整形した設定オブジェクトを生成します。
 * local.ts または cloudflare.ts から生の環境変数の値を RawConfig 型として回収し、buildConfig で組み立てて返却します。
 */
export function getConfig(env?: Record<string, string | undefined>): ApiConfig {
  const rawEnv = env ? getCloudflareEnv(env) : getLocalEnv();
  return buildConfig(rawEnv);
}

export const config = getConfig();
