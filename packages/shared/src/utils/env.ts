/**
 * 与えられた環境変数名 (または優先順キー配列) に基づき、
 * Cloudflare Workers の環境バインディングオブジェクト (env)
 * またはローカルの process.env から値を取得して環境間の差分を吸収します。
 */
export function getEnv(
  keyOrKeys: string | string[],
  env?: Record<string, unknown>,
  defaultValue?: string,
): string | undefined {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

  for (const key of keys) {
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      const val = env[key];
      if (typeof val === "string") {
        return val;
      }
    }
    if (
      typeof process !== "undefined" &&
      process.env &&
      Object.prototype.hasOwnProperty.call(process.env, key)
    ) {
      const val = process.env[key];
      if (typeof val === "string") {
        return val;
      }
    }
  }

  return defaultValue;
}
