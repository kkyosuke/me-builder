import { type webhook as lineWebhook, validateSignature } from "@line/bot-sdk";
import { logger } from "@me-builder/shared";
import { type LineClientConfig, client } from "./client";

/**
 * LINE Webhook の署名検証に必要な入力。
 * body は必ず受信した生のリクエストボディ文字列を渡すこと
 * (JSON.parse したものを再度 JSON.stringify するとバイト列が変わり検証が壊れる)。
 */
export type VerifySignatureParams = {
  /** 受信した生のリクエストボディ文字列 */
  body: string;
  /** LINE Developers コンソールで発行されるチャネルシークレット */
  channelSecret: string;
  /** リクエストの x-line-signature ヘッダ値 (欠落時は undefined / null) */
  signature: string | null | undefined;
};

/**
 * LINE Platform から送信された Webhook リクエストの x-line-signature を検証します。
 *
 * 公式 SDK (@line/bot-sdk) の `validateSignature` に委譲します。
 * SDK 内部では node:crypto の `createHmac` / `timingSafeEqual` を用いており、
 * `nodejs_compat` を有効化した Cloudflare Workers (workerd) 上でも動作することを確認済みです。
 * そのため Web Crypto によるフォールバック実装は用意していません。
 */
function verifySignature({ body, channelSecret, signature }: VerifySignatureParams): boolean {
  if (!channelSecret || !signature) {
    return false;
  }

  try {
    return validateSignature(body, channelSecret, signature);
  } catch (error) {
    // 署名値やチャネルシークレットそのものはログに出さない
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Failed to validate LINE webhook signature",
    );
    return false;
  }
}

/**
 * LINE Messaging API SDK (@line/bot-sdk) を使用して Webhook Endpoint URL を登録・更新します。
 */
async function register(config: LineClientConfig): Promise<{ success: boolean; message: string }> {
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
function extractMessages(payload: unknown): string[] {
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
function parseEvents(payload: unknown): lineWebhook.Event[] {
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

export const webhook: {
  register: (config: LineClientConfig) => Promise<{ success: boolean; message: string }>;
  parseEvents: (payload: unknown) => lineWebhook.Event[];
  extractMessages: (payload: unknown) => string[];
  verifySignature: (params: VerifySignatureParams) => boolean;
} = {
  register,
  parseEvents,
  extractMessages,
  verifySignature,
};
