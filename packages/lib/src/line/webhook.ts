import type { webhook as lineWebhook } from "@line/bot-sdk";
import { logger } from "@me-builder/shared";
import { type LineClientConfig, client } from "./client";

/**
 * LINE Messaging API SDK (@line/bot-sdk) を使用して Webhook Endpoint URL を登録・更新します。
 */
export async function register(
  config: LineClientConfig,
): Promise<{ success: boolean; message: string }> {
  const token = config.channelAccessToken;
  const url = config.webhookUrl;

  if (!token || !url) {
    const msg =
      "[LINE Webhook] LINE_CHANNEL_ACCESS_TOKEN または Webhook URL (LINE_WEBHOOK_URL / BASE_URL) が設定されていないため自動登録をスキップします。";
    logger.info(msg);
    return { success: false, message: msg };
  }

  try {
    const apiClient = client.create(token);
    await apiClient.setWebhookEndpoint({
      endpoint: url,
    });

    const msg = `[LINE Webhook] LINE Messaging API SDK により Webhook URL を正常に登録しました: ${url}`;
    logger.info(msg);
    return { success: true, message: msg };
  } catch (error) {
    const msg = `[LINE Webhook] LINE Messaging API SDK でのエラーが発生しました: ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.error(msg);
    return { success: false, message: msg };
  }
}

/**
 * LINE Webhook ペイロードからテキストメッセージを抽出します。
 */
export function extractMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || payload === null) {
    return [];
  }
  const events = (payload as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    return [];
  }
  const messages: string[] = [];
  for (const event of events) {
    if (
      event &&
      typeof event === "object" &&
      event.type === "message" &&
      event.message &&
      typeof event.message === "object" &&
      event.message.type === "text" &&
      typeof event.message.text === "string"
    ) {
      messages.push(event.message.text);
    }
  }
  return messages;
}

/**
 * LINE Webhook のイベントペイロードを解析し、WebhookEvent の配列として返します。
 */
export function parseEvents(payload: unknown): lineWebhook.Event[] {
  if (!payload || typeof payload !== "object" || payload === null) {
    logger.warn("Received invalid LINE webhook payload (not an object)");
    return [];
  }

  const events = (payload as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    logger.info("LINE webhook payload contains no events");
    return [];
  }

  return events as lineWebhook.Event[];
}

export const webhook = {
  register,
  parseEvents,
  extractMessages,
};
