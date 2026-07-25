import { logger } from "@me-builder/shared";
import { type LineClientConfig, client } from "./client";

export interface LineReplyResult {
  processedCount: number;
  repliedCount: number;
}

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
 * LINE Webhook のイベントペイロードを解析し、メッセージイベントの replyToken を用いて同じ内容を返信します。
 */
export async function handleEvent(
  payload: unknown,
  channelAccessToken?: string,
): Promise<LineReplyResult> {
  const result: LineReplyResult = {
    processedCount: 0,
    repliedCount: 0,
  };

  if (!payload || typeof payload !== "object") {
    logger.warn("Received invalid LINE webhook payload (not an object)");
    return result;
  }

  const events = (payload as Record<string, unknown>).events;
  if (!Array.isArray(events) || events.length === 0) {
    logger.info("LINE webhook payload contains no events");
    return result;
  }

  if (!channelAccessToken) {
    logger.warn(
      "[LINE Reply] LINE_CHANNEL_ACCESS_TOKEN is not configured. Skipping replyMessage calls.",
    );
    return result;
  }

  const apiClient = client.create(channelAccessToken);

  for (const event of events) {
    result.processedCount++;
    if (
      event &&
      typeof event === "object" &&
      event.type === "message" &&
      typeof event.replyToken === "string" &&
      event.message &&
      typeof event.message === "object" &&
      event.message.type === "text" &&
      typeof event.message.text === "string"
    ) {
      const replyToken = event.replyToken;
      const text = event.message.text;

      try {
        await apiClient.replyMessage({
          replyToken,
          messages: [
            {
              type: "text",
              text,
            },
          ],
        });
        result.repliedCount++;
        logger.info(
          { replyToken, textLength: text.length },
          "[LINE Reply] Echo reply sent successfully via LINE Messaging API",
        );
      } catch (error) {
        logger.error(
          {
            replyToken,
            error: error instanceof Error ? error.message : String(error),
          },
          "[LINE Reply] Failed to send reply message via LINE Messaging API",
        );
      }
    }
  }

  return result;
}

export const webhook = {
  register,
  handleEvent,
};
