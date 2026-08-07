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
  /** 1対1トークへチャットローディングを表示する。未設定時は安全にスキップする */
  startChatLoading?: ((chatId: string) => Promise<unknown>) | undefined;
  /** チャットローディングの完了をWebhook応答後まで待機させる */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
};

export type LineWebhookOutcome =
  /** 受理して Queue へ投入した（Queue 未設定なら `queued: false`） */
  | { type: "accepted"; id: string; queued: boolean }
  /** チャネルシークレットが未設定で検証できない（サーバー側の設定漏れ） */
  | { type: "secret-not-configured" }
  /** 署名が無い、または一致しない */
  | { type: "invalid-signature" };

function extractOneToOneTextChatIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const events = (payload as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    return [];
  }

  const chatIds = new Set<string>();
  for (const webhookEvent of events) {
    if (!webhookEvent || typeof webhookEvent !== "object") {
      continue;
    }
    const event = webhookEvent as Record<string, unknown>;
    const message = event.message;
    const source = event.source;
    if (
      event.type === "message" &&
      message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).type === "text" &&
      source &&
      typeof source === "object" &&
      (source as Record<string, unknown>).type === "user" &&
      typeof (source as Record<string, unknown>).userId === "string"
    ) {
      chatIds.add((source as Record<string, unknown>).userId as string);
    }
  }
  return [...chatIds];
}

function routeLineTextEvents(payload: unknown): NonNullable<WebhookQueueMessage["routing"]> {
  return {
    lineTextEvents: line.webhook.parseEvents(payload).flatMap((event) => {
      if (event.type !== "message" || !event.message || event.message.type !== "text") return [];
      const eventId = event.webhookEventId ?? event.message.id;
      return eventId ? [{ eventId, intent: line.text.classify(event.message.text) }] : [];
    }),
  };
}

/** 一度しか使えないreplyTokenを非同期境界の外へ持ち出さない。 */
export function removeDiaryReplyTokens(payload: unknown): unknown {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { events?: unknown }).events)
  ) {
    return payload;
  }
  return {
    ...(payload as Record<string, unknown>),
    events: (payload as { events: unknown[] }).events.map((event) => {
      if (!event || typeof event !== "object") return event;
      const eventRecord = event as Record<string, unknown>;
      const message = eventRecord.message;
      const isDiagnosis =
        eventRecord.type === "message" &&
        message &&
        typeof message === "object" &&
        (message as Record<string, unknown>).type === "text" &&
        typeof (message as Record<string, unknown>).text === "string" &&
        line.text.classify((message as Record<string, unknown>).text as string) ===
          "diagnosis-request";
      if (isDiagnosis) return event;
      const { replyToken: _replyToken, ...safeEvent } = eventRecord;
      return safeEvent;
    }),
  };
}

export async function receiveLineWebhook({
  rawBody,
  signature,
  channelSecret,
  queue,
  startChatLoading,
  waitUntil,
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
    payload: removeDiaryReplyTokens(payload),
    routing: routeLineTextEvents(payload),
  };

  const messages = line.webhook.extractMessages(payload);

  const chatIds = extractOneToOneTextChatIds(payload);

  if (startChatLoading && waitUntil) {
    waitUntil(
      Promise.all(
        chatIds.map(async (chatId) => {
          try {
            await startChatLoading(chatId);
          } catch (error) {
            // userIdは本人識別子なのでログへ含めない。ローディング失敗でも本処理は継続する。
            logger.warn(
              { errorName: error instanceof Error ? error.name : "UnknownError" },
              "Failed to start LINE chat loading animation",
            );
          }
        }),
      ),
    );
  }

  if (!queue) {
    logger.warn(
      { id: event.id, source: event.source, messageCount: messages.length },
      "WEBHOOK_QUEUE binding not configured, skipping queue push",
    );
    return { type: "accepted", id: event.id, queued: false };
  }

  await queue.send(event);
  logger.info(
    { id: event.id, source: event.source, messageCount: messages.length },
    "Webhook event queued to WEBHOOK_QUEUE",
  );

  return { type: "accepted", id: event.id, queued: true };
}
