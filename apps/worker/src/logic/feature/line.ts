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
    const providerAccountId = event.source?.userId;

    // 1. followイベント時はユーザー情報をUpsertする
    if (event.type === "follow") {
      if (providerAccountId) {
        try {
          await d1.action.account.upsertIdentity(db, {
            provider: "line",
            providerAccountId,
          });
          logger.info(
            { providerAccountId },
            "[LINE Webhook] Account identity upserted on follow event",
          );
        } catch (err) {
          logger.error(
            { err, providerAccountId },
            "[LINE Webhook] Failed to upsert account identity on follow event",
          );
        }
      }
      continue;
    }

    // 2. messageイベント時の処理
    if (event.type === "message" && event.message.type === "text" && event.replyToken) {
      // NOTE: 今後DBにメッセージを保存する実装を追加する場合、
      // ユーザーの内部ID(accountId)を取得するために SELECT または Lazy Upsert を行います。
      // (例: メッセージInsert時に外部キー制約エラーが出たら catch して upsertIdentity してリトライする等)
      // 現状はただのEchoなのでDB操作は行わず、そのまま返信します。
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
