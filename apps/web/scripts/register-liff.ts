import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { config } from "../src/config";

/**
 * デプロイ済みの Web の URL を LIFF アプリのエンドポイント URL へ反映します。
 * Webhook Endpoint URL の自動登録 (`bun --cwd apps/api scripts/register-webhook.ts`) と同じ位置づけです。
 *
 *   bun scripts/register-liff.ts <preview|production>
 *
 * 環境名は LIFF アプリを識別する description に使うため、引数で明示します
 * (`config.environment` はビルド時の値なので、CD の実行環境と一致しない)。
 */
const targetEnv = process.argv[2];

if (targetEnv !== "preview" && targetEnv !== "production") {
  logger.info("[Script] Usage: bun scripts/register-liff.ts <preview|production>");
  process.exit(0);
}

const endpointUrl = config.baseUrl?.replace(/\/$/, "");

logger.info(`[Script] Executing LIFF endpoint registration for ${targetEnv}...`);

const result = await line.liff.registerEndpoint({
  channelId: process.env.LINE_LOGIN_CHANNEL_ID,
  channelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  liffId: config.liffId,
  endpointUrl,
  description: `me-builder-web (${targetEnv})`,
  viewType: "full",
});

if (!result.success) {
  throw new Error(`[Script] LIFF registration failed: ${result.message}`);
}

logger.info(`[Script] LIFF registration completed. LIFF ID: ${result.liffId}`);
