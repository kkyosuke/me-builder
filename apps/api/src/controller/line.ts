import { line } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  LineWebhookAcceptedResponseSchema,
  LineWebhookUnauthorizedResponseSchema,
} from "../contract/line/webhook";
import { receiveLineWebhook } from "../logic/line-webhook";
import type { AppEnv } from "../types";

/**
 * `/api/line/` 配下のエンドポイントの controller。
 *
 * リクエストの解釈と、logic が返したドメイン上の結果から HTTP レスポンスへの変換だけを
 * 担当します。ドメインの判断は `logic/` にあります。
 */

/** `POST /api/line/webhook` — 署名を検証して Queue へ投入する。 */
export async function postLineWebhook(c: Context<AppEnv>): Promise<Response> {
  const currentConfig = getConfig(c.env);
  const lineClient = currentConfig.lineChannelAccessToken
    ? line.client.create(currentConfig.lineChannelAccessToken)
    : undefined;

  // 署名検証は生のリクエストボディ文字列に対して行う必要があるため、text() で取得する
  const rawBody = await c.req.text();

  const outcome = await receiveLineWebhook({
    rawBody,
    signature: c.req.header("x-line-signature"),
    channelSecret: currentConfig.lineChannelSecret,
    queue: currentConfig.webhookQueue,
    environment: currentConfig.environment,
    photoDiaryStorageEnabled: currentConfig.photoDiaryStorageEnabled,
    startChatLoading: lineClient
      ? (chatId) => lineClient.showLoadingAnimation({ chatId, loadingSeconds: 60 })
      : undefined,
    replyUnsupportedMessage: lineClient
      ? (replyToken, text) =>
          lineClient.replyMessage({
            replyToken,
            messages: [{ type: "text", text }],
          })
      : undefined,
    waitUntil: (promise) => {
      try {
        c.executionCtx.waitUntil(promise);
      } catch {
        // BunのローカルサーバーにはExecutionContextがない。Promiseの失敗はlogic側で処理する。
        void promise;
      }
    },
  });

  switch (outcome.type) {
    case "accepted":
      return c.json(
        v.parse(LineWebhookAcceptedResponseSchema, {
          status: "ok",
          queued: outcome.queued,
          id: outcome.id,
        }),
      );
    case "secret-not-configured":
    case "invalid-signature":
      return c.json(v.parse(LineWebhookUnauthorizedResponseSchema, { error: "Unauthorized" }), 401);
  }
}
