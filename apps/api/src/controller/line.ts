import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { LiffSessionRequestSchema, LiffSessionResponseSchema } from "../contract/line/liff-session";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { createLiffSession } from "../logic/liff-session";
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

  // 署名検証は生のリクエストボディ文字列に対して行う必要があるため、text() で取得する
  const rawBody = await c.req.text();

  const outcome = await receiveLineWebhook({
    rawBody,
    signature: c.req.header("x-line-signature"),
    channelSecret: currentConfig.lineChannelSecret,
    queue: currentConfig.webhookQueue,
  });

  switch (outcome.type) {
    case "accepted":
      return c.json({ status: "ok", queued: outcome.queued, id: outcome.id });
    case "secret-not-configured":
    case "invalid-signature":
      return c.json({ error: "Unauthorized" }, 401);
  }
}

/**
 * `POST /api/line/liff/session` — ID トークンを検証して Account を解決する。
 *
 * 設定漏れ (`not-configured`) と検証失敗 (`unauthenticated`) は、サーバーの設定状態を
 * クライアントへ推測させないため、どちらも同じ 401 に落とします。
 */
export async function postLiffSession(c: Context<AppEnv>): Promise<Response> {
  const currentConfig = getConfig(c.env);

  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  let idToken: string | undefined;
  try {
    const body = v.safeParse(LiffSessionRequestSchema, await c.req.json());
    idToken = body.success ? body.output.idToken : undefined;
  } catch {
    // JSON でないボディは「ID トークンが無い」と同じ扱いにする
    idToken = undefined;
  }

  const outcome = await createLiffSession({
    idToken,
    lineLoginChannelId: currentConfig.lineLoginChannelId,
    db: d1.client.create(c.env.DB),
  });

  switch (outcome.type) {
    case "resolved":
      // accountId は返さない。セッション管理の方式が未決定
      // ([ドメイン設計](../../../../docs/domain/domain-design.md)) のうちにクライアントへ渡すと、
      // 後続リクエストで「クライアントが送ってきた accountId」を信頼する実装を誘発する。
      return c.json(
        v.parse(LiffSessionResponseSchema, {
          displayName: outcome.session.displayName,
          pictureUrl: outcome.session.pictureUrl,
        }),
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}
