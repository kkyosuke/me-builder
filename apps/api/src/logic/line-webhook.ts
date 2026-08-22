import { line } from "@me-builder/lib";
import {
  OperationalError,
  type Queue,
  type WebhookQueueMessage,
  logger,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { isDevelopmentEnvironment } from "../config";

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
  /** Queue 未設定時に縮退を許可するか判定する実行環境 */
  environment: string;
  /** 1対1トークへチャットローディングを表示する。未設定時は安全にスキップする */
  startChatLoading?: ((chatId: string) => Promise<unknown>) | undefined;
  /** チャットローディングの完了をWebhook応答後まで待機させる */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  /** 現在扱えない非テキストmessageへ定型文を返信する */
  replyUnsupportedMessage?: ((replyToken: string, text: string) => Promise<unknown>) | undefined;
  /** 法務・規約release gateを通過した環境だけLINE画像をQueueへ残す。 */
  photoDiaryStorageEnabled?: boolean;
};

export const UNSUPPORTED_MESSAGE_REPLY_TEXT =
  "ごめんね、テキスト以外のメッセージは今は読み込めないよ。テキストで送ってね。";

export type LineWebhookOutcome =
  /** 受理して Queue へ投入した（ローカル開発で Queue 未設定なら `queued: false`） */
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

function excludeUnsupportedMessageEvents(
  payload: unknown,
  photoDiaryStorageEnabled: boolean,
): {
  payload: unknown;
  replyTokens: string[];
  excludedCount: number;
  hasRemainingEvents: boolean;
} {
  if (!payload || typeof payload !== "object") {
    return { payload, replyTokens: [], excludedCount: 0, hasRemainingEvents: true };
  }
  const events = (payload as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    return { payload, replyTokens: [], excludedCount: 0, hasRemainingEvents: true };
  }

  const replyTokens: string[] = [];
  const remainingEvents = events.filter((webhookEvent) => {
    if (!webhookEvent || typeof webhookEvent !== "object") return true;
    const event = webhookEvent as Record<string, unknown>;
    const message = event.message;
    const messageRecord =
      message && typeof message === "object" ? (message as Record<string, unknown>) : undefined;
    const sourceRecord =
      event.source && typeof event.source === "object"
        ? (event.source as Record<string, unknown>)
        : undefined;
    const isEnabledLineImage =
      photoDiaryStorageEnabled &&
      messageRecord?.type === "image" &&
      messageRecord.contentProvider !== null &&
      typeof messageRecord.contentProvider === "object" &&
      (messageRecord.contentProvider as Record<string, unknown>).type === "line" &&
      sourceRecord?.type === "user" &&
      typeof sourceRecord.userId === "string";
    if (
      event.type !== "message" ||
      !messageRecord ||
      messageRecord.type === "text" ||
      isEnabledLineImage
    ) {
      return true;
    }
    if (typeof event.replyToken === "string" && event.replyToken.length > 0) {
      replyTokens.push(event.replyToken);
    }
    return false;
  });

  return {
    payload: { ...(payload as Record<string, unknown>), events: remainingEvents },
    replyTokens,
    excludedCount: events.length - remainingEvents.length,
    hasRemainingEvents: remainingEvents.length > 0,
  };
}

export async function receiveLineWebhook({
  rawBody,
  signature,
  channelSecret,
  queue,
  environment,
  startChatLoading,
  waitUntil,
  replyUnsupportedMessage,
  photoDiaryStorageEnabled = false,
}: ReceiveLineWebhookParams): Promise<LineWebhookOutcome> {
  // 未設定の場合は環境を問わず検証をスキップせず拒否する
  if (!channelSecret) {
    logger.error(
      // 設定漏れも署名不正も、サーバーの設定状態を推測させないため401へ落としている。
      "[LINE webhook] rejected at signature.verify -> 401 (LINE_CHANNEL_SECRET is not configured)",
    );
    return { type: "secret-not-configured" };
  }

  if (!line.webhook.verifySignature({ body: rawBody, channelSecret, signature })) {
    // 署名値・チャネルシークレットそのものはログに残さない
    logger.warn(
      { hasSignatureHeader: Boolean(signature), bodyLength: rawBody.length },
      "[LINE webhook] rejected at signature.verify -> 401 (missing or invalid x-line-signature)",
    );
    return { type: "invalid-signature" };
  }

  let payload: unknown = {};
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    logger.warn(
      { bodyLength: rawBody.length },
      "[LINE webhook] received a non-JSON body at payload.parse; continuing with an empty payload",
    );
  }

  const filtered = excludeUnsupportedMessageEvents(payload, photoDiaryStorageEnabled);
  if (filtered.excludedCount > 0) {
    const unsupportedReplies = Promise.all(
      filtered.replyTokens.map(async (replyToken) => {
        if (!replyUnsupportedMessage) return;
        try {
          await replyUnsupportedMessage(replyToken, UNSUPPORTED_MESSAGE_REPLY_TEXT);
        } catch (error) {
          // replyTokenやSDK responseはログへ含めない。返信失敗でも非テキストは後段へ渡さない。
          logger.warn(
            { errorName: error instanceof Error ? error.name : "UnknownError" },
            "[LINE webhook] could not reply to an unsupported message; the message remains excluded",
          );
        }
      }),
    );
    // LINE返信の遅延で、同じWebhookに含まれるテキストのQueue投入をブロックしない。
    // controllerがExecutionContextへ登録し、ローカル実行でも開始済みPromiseとして継続する。
    waitUntil?.(unsupportedReplies);
  }

  const traceId = crypto.randomUUID();
  const event: WebhookQueueMessage = {
    id: traceId,
    traceId,
    source: "line",
    receivedAt: new Date().toISOString(),
    // replyTokenは日記のfinalをpushではなくreplyで返すために残す。
    // D1へは保存せず、logへも出さず、Coordinatorが払い出した時点で破棄する。
    payload: filtered.payload,
    routing: routeLineTextEvents(filtered.payload),
  };

  const messageCount = line.webhook
    .parseEvents(filtered.payload)
    .filter(({ type }) => type === "message").length;

  if (filtered.excludedCount > 0 && !filtered.hasRemainingEvents) {
    logger.info(
      {
        event: "line.webhook.accepted",
        service: "api",
        traceId,
        component: "line-webhook",
        outcome: "succeeded",
        disposition: "ignored-unsupported-message",
        source: event.source,
        excludedCount: filtered.excludedCount,
      },
      "[LINE webhook] succeeded at input.filter -> ignored-unsupported-message",
    );
    return { type: "accepted", id: event.id, queued: false };
  }

  // previewは開発用機能を利用できる環境だが、実際にLINE Webhookを受信するデプロイ環境なので
  // Queue未設定をローカル開発用の縮退へ倒さない。
  const canDegradeWithoutQueue = isDevelopmentEnvironment(environment) && environment !== "preview";
  if (!queue && !canDegradeWithoutQueue) {
    const errorDescriptor = {
      code: "WEBHOOK_QUEUE_BINDING_MISSING",
      category: "configuration",
      stage: "queue.configure",
      retryable: true,
      dependency: "cloudflare-queue",
    } as const;
    const error = new OperationalError(errorDescriptor);
    logger.error(
      {
        event: "line.webhook.failed",
        service: "api",
        traceId,
        component: "line-webhook",
        outcome: "failed",
        disposition: "http-error",
        source: event.source,
        messageCount,
        ...toSafeOperationalErrorFields(error, errorDescriptor),
      },
      "[LINE webhook] failed at queue.configure -> http-error (WEBHOOK_QUEUE_BINDING_MISSING, category:configuration, via:cloudflare-queue)",
    );
    throw error;
  }

  const chatIds = extractOneToOneTextChatIds(filtered.payload);

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
              "[LINE webhook] could not start the chat loading animation; webhook processing continues",
            );
          }
        }),
      ),
    );
  }

  if (!queue) {
    logger.warn(
      {
        event: "line.webhook.accepted",
        service: "api",
        traceId,
        component: "line-webhook",
        outcome: "degraded",
        disposition: "not-queued",
        source: event.source,
        messageCount,
      },
      "[LINE webhook] degraded at queue.send -> not-queued (WEBHOOK_QUEUE binding is not configured)",
    );
    return { type: "accepted", id: event.id, queued: false };
  }

  try {
    await queue.send(event);
  } catch (error) {
    logger.error(
      {
        event: "line.webhook.failed",
        service: "api",
        traceId,
        component: "line-webhook",
        outcome: "failed",
        disposition: "http-error",
        source: event.source,
        messageCount,
        ...toSafeOperationalErrorFields(error, {
          code: "WEBHOOK_QUEUE_SEND_FAILED",
          category: "dependency",
          stage: "queue.send",
          retryable: true,
          dependency: "cloudflare-queue",
        }),
      },
      "[LINE webhook] failed at queue.send -> http-error (WEBHOOK_QUEUE_SEND_FAILED, category:dependency, via:cloudflare-queue)",
    );
    throw error;
  }
  logger.info(
    {
      event: "line.webhook.accepted",
      service: "api",
      traceId,
      component: "line-webhook",
      outcome: "succeeded",
      disposition: "queued",
      source: event.source,
      messageCount,
    },
    "[LINE webhook] succeeded at queue.send -> queued (handed off to the Worker with the same traceId)",
  );

  return { type: "accepted", id: event.id, queued: true };
}
