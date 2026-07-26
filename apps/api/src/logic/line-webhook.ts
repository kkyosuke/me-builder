import { line } from "@me-builder/lib";
import { type Queue, type WebhookQueueMessage, logger } from "@me-builder/shared";

/**
 * LINE Webhook を受理し、Cloudflare Queues へ投入します。
 *
 * 署名検証は **受信した生のリクエストボディ文字列** に対して行います。`JSON.parse` した結果を
 * 再度 `JSON.stringify` するとバイト列が変わり検証が壊れるため、controller から生の文字列を
 * 受け取ります。
 *
 * この層は HTTP を知りません。ステータスコードへの変換は controller が行います。
 */

export type ReceiveLineWebhookParams = {
  /** 受信した生のリクエストボディ文字列 */
  rawBody: string;
  /** `x-line-signature` ヘッダの値 */
  signature: string | null | undefined;
  channelSecret: string | undefined;
  queue: Queue<WebhookQueueMessage> | undefined;
};

export type LineWebhookOutcome =
  /** 受理して Queue へ投入した（Queue 未設定なら `queued: false`） */
  | { type: "accepted"; id: string; queued: boolean }
  /** チャネルシークレットが未設定で検証できない（サーバー側の設定漏れ） */
  | { type: "secret-not-configured" }
  /** 署名が無い、または一致しない */
  | { type: "invalid-signature" };

export async function receiveLineWebhook({
  rawBody,
  signature,
  channelSecret,
  queue,
}: ReceiveLineWebhookParams): Promise<LineWebhookOutcome> {
  // 未設定の場合は環境を問わず検証をスキップせず拒否する
  if (!channelSecret) {
    logger.error("LINE_CHANNEL_SECRET is not configured, rejecting LINE webhook request");
    return { type: "secret-not-configured" };
  }

  if (!line.webhook.verifySignature({ body: rawBody, channelSecret, signature })) {
    // 署名値・チャネルシークレットそのものはログに残さない
    logger.warn(
      { hasSignatureHeader: Boolean(signature), bodyLength: rawBody.length },
      "Rejected LINE webhook request with missing or invalid x-line-signature",
    );
    return { type: "invalid-signature" };
  }

  let payload: unknown = {};
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    logger.warn(
      { bodyLength: rawBody.length },
      "Received LINE webhook request with a non-JSON body",
    );
  }

  const event: WebhookQueueMessage = {
    id: crypto.randomUUID(),
    source: "line",
    receivedAt: new Date().toISOString(),
    payload,
  };

  const messages = line.webhook.extractMessages(payload);

  if (!queue) {
    logger.warn(
      { id: event.id, source: event.source, messages: messages.length > 0 ? messages : undefined },
      "WEBHOOK_QUEUE binding not configured, skipping queue push",
    );
    return { type: "accepted", id: event.id, queued: false };
  }

  await queue.send(event);
  logger.info(
    { id: event.id, source: event.source, messages: messages.length > 0 ? messages : undefined },
    "Webhook event queued to WEBHOOK_QUEUE",
  );

  return { type: "accepted", id: event.id, queued: true };
}
