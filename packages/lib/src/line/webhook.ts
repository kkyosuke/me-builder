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

/** Webhook Endpoint URL の登録に渡すパラメータ。 */
export type RegisterWebhookParams = LineClientConfig & {
  /**
   * 既に同じ URL が有効な状態で登録済みでも、再登録と疎通確認をやり直します。
   *
   * 既定 (false) では現在の登録状態を 1 回問い合わせるだけで終わります。
   * `testWebhookEndpoint` は LINE Platform が実際に Webhook URL を呼び出して応答を待つため
   * 十数秒かかり、URL が変わっていないデプロイでこれを毎回実行すると CD の実行時間を浪費します。
   */
  forceVerify?: boolean;
};

/** Webhook Endpoint URL の登録結果。 */
export type RegisterWebhookResult = {
  success: boolean;
  message: string;
  /** 既に要求どおり登録済みだったため、再登録と疎通確認を省略した */
  skipped: boolean;
};

/**
 * LINE Messaging API SDK (@line/bot-sdk) を使用して Webhook Endpoint URL を登録・更新します。
 *
 * URL が既に有効な状態で登録済みなら何もしません。実際に登録内容を書き換えたときだけ、
 * 登録後の URL 一致・有効化状態・LINE Platform からの疎通を検証します。
 */
async function register(config: RegisterWebhookParams): Promise<RegisterWebhookResult> {
  const token = config.channelAccessToken;
  const url = config.webhookUrl;

  if (!token || !url) {
    const msg =
      "[LINE Webhook] LINE_CHANNEL_ACCESS_TOKEN または Webhook URL (LINE_WEBHOOK_URL / BASE_URL) が設定されていないため自動登録をスキップします。";
    logger.info(msg);
    return { success: false, message: msg, skipped: false };
  }

  try {
    const apiClient = client.create(token);

    if (!config.forceVerify) {
      // 未登録の場合 LINE は 404 を返すため、失敗は「登録済みではない」として扱う。
      const current = await apiClient.getWebhookEndpoint().catch(() => undefined);
      if (current?.endpoint === url && current.active) {
        const msg = `[LINE Webhook] Webhook URL は既に登録・有効化済みのため、再登録と疎通確認をスキップしました: ${url}`;
        logger.info(msg);
        return { success: true, message: msg, skipped: true };
      }
    }

    await apiClient.setWebhookEndpoint({
      endpoint: url,
    });

    const configured = await apiClient.getWebhookEndpoint();
    if (configured.endpoint !== url) {
      const msg = "[LINE Webhook] 登録後の Webhook URL が要求した URL と一致しません。";
      logger.error(msg);
      return { success: false, message: msg, skipped: false };
    }
    if (!configured.active) {
      const msg =
        "[LINE Webhook] Webhook が無効です。LINE Developers コンソールで Webhook の利用を有効にしてください。";
      logger.error(msg);
      return { success: false, message: msg, skipped: false };
    }

    const tested = await apiClient.testWebhookEndpoint({ endpoint: url });
    if (!tested.success || tested.statusCode !== 200) {
      const msg = `[LINE Webhook] LINE Platform から Webhook URL への疎通確認に失敗しました (status=${tested.statusCode}, reason=${tested.reason})。`;
      logger.error(msg);
      return { success: false, message: msg, skipped: false };
    }

    const msg = `[LINE Webhook] Webhook URL の登録・有効化・疎通を確認しました: ${url}`;
    logger.info(msg);
    return { success: true, message: msg, skipped: false };
  } catch (error) {
    const msg = `[LINE Webhook] LINE Messaging API SDK でのエラーが発生しました: ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.error(msg);
    return { success: false, message: msg, skipped: false };
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
  register: (config: RegisterWebhookParams) => Promise<RegisterWebhookResult>;
  parseEvents: (payload: unknown) => lineWebhook.Event[];
  extractMessages: (payload: unknown) => string[];
  verifySignature: (params: VerifySignatureParams) => boolean;
} = {
  register,
  parseEvents,
  extractMessages,
  verifySignature,
};
