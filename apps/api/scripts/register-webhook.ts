import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { config } from "../src/config";

/**
 * LINE の Webhook Endpoint URL を登録します。
 *
 *   bun scripts/register-webhook.ts [--force]
 *
 * 既定では、要求する URL が既に有効な状態で登録済みなら何もしません。LINE Platform からの
 * 疎通確認は Webhook URL への往復を待つため十数秒かかり、URL が変わらないデプロイで
 * 毎回実行する価値がないためです。URL の変更後や疎通を明示的に確かめたいときは `--force`
 * を渡すと、再登録と疎通確認まで実行します。
 */
const forceVerify = process.argv.includes("--force");

logger.info({ forceVerify }, "[Script] Executing LINE Webhook registration...");

const result = await line.webhook.register({
  channelAccessToken: config.lineChannelAccessToken,
  webhookUrl: config.lineWebhookUrl,
  forceVerify,
});

if (!result.success) {
  throw new Error(`[Script] Registration process failed: ${result.message}`);
}

logger.info({ skipped: result.skipped }, "[Script] Registration process completed successfully.");
