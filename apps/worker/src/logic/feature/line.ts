import { d1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { WorkerConfig } from "../../config";

export async function processLineWebhook(
  payload: unknown,
  db: d1.Client,
  workerConfig?: WorkerConfig,
): Promise<void> {
  if (!workerConfig?.lineChannelAccessToken) {
    logger.warn("[LINE Reply] LINE_CHANNEL_ACCESS_TOKEN is not configured.");
    return;
  }

  const events = line.webhook.parseEvents(payload);
  const apiClient = line.client.create(workerConfig.lineChannelAccessToken);

  for (const event of events) {
    // ユーザー情報のUpsert処理
    const providerAccountId = event.source?.userId;
    let account = null;

    if (providerAccountId) {
      try {
        const result = await d1.action.account.upsertIdentity(db, {
          provider: "line",
          providerAccountId,
        });
        account = result.account;
      } catch (err) {
        logger.error(
          { err, providerAccountId },
          "[LINE Webhook] Failed to upsert account identity",
        );
        continue;
      }
    }

    if (!account) {
      logger.warn(
        { providerAccountId },
        "[LINE Webhook] Account identity not found or created. Skipping message.",
      );
      continue;
    }

    if (event.type === "message" && event.message.type === "text" && event.replyToken) {
      await handleTextMessage(event.replyToken, event.message.text, apiClient);
    }
  }
}

async function handleTextMessage(
  replyToken: string,
  text: string,
  apiClient: ReturnType<typeof line.client.create>,
): Promise<void> {
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
    logger.info(
      { replyToken, text, textLength: text.length },
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
