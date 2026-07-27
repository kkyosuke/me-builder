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
      await ensureAccountIdentity(db, providerAccountId, "follow");
      continue;
    }

    // 2. messageイベント時の処理
    if (event.type === "message" && event.message.type === "text" && event.replyToken) {
      // メッセージが届いている = 友だちである証明なので、follow イベントを取り逃していても
      // ここで Account を補完する。友だち追加より前から利用しているユーザーや、
      // follow イベントの処理に失敗したユーザーが Web 側で本人確認できなくなるのを防ぐ。
      await ensureAccountIdentity(db, providerAccountId, "message");
      await handleTextMessage(event.replyToken, apiClient, workerConfig.liffId);
    }
  }
}

/**
 * LINE の userId に対応する Account を用意します。
 *
 * アカウント作成の起点は LINE 公式アカウントの友だち追加です
 * ([プロジェクト概要 §5](../../../../../docs/project-overview.md#5-アカウントと本人識別))。
 * follow イベントと、友だちであることが確かなメッセージ受信時のみ呼び出します。
 *
 * 失敗しても返信は行うため、例外は握りつぶしてログだけ残します。
 */
async function ensureAccountIdentity(
  db: d1.Client,
  providerAccountId: string | undefined,
  trigger: "follow" | "message",
): Promise<void> {
  if (!providerAccountId) {
    return;
  }

  try {
    await d1.action.account.upsertIdentity(db, { provider: "line", providerAccountId });
    logger.info({ trigger }, "[LINE Webhook] Account identity ensured");
  } catch (err) {
    logger.error({ err, trigger }, "[LINE Webhook] Failed to ensure account identity");
  }
}

/**
 * 日記を受け付けた旨の返信文を組み立てます。
 *
 * LIFF ID が設定されている場合は「今日のアンケート」への導線として LIFF の URL を添えます。
 * LIFF の URL をタップすると LINE 内で Web が開きます
 * ([プロジェクト概要 §4](../../../../../docs/project-overview.md#4-想定する利用体験))。
 * 未設定の場合はリンクを省き、受け付けた旨だけを返します。
 */
export function buildReplyText(liffId?: string): string {
  const received = "受け付けました。";
  if (!liffId) {
    return received;
  }
  return `${received}\n今日のアンケートに答える\nhttps://liff.line.me/${liffId}`;
}

async function handleTextMessage(
  replyToken: string,
  apiClient: ReturnType<typeof line.client.create>,
  liffId?: string,
): Promise<void> {
  try {
    await apiClient.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: buildReplyText(liffId),
        },
      ],
    });
    logger.info(
      { replyToken, hasLiffLink: Boolean(liffId) },
      "[LINE Reply] Reply sent successfully via LINE Messaging API",
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
