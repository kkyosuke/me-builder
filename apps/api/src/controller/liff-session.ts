import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import { getConfig } from "../config";
import { createLiffSession } from "../logic/liff-session";
import type { AppEnv } from "../types";

/**
 * `POST /api/line/liff/session` の controller。
 *
 * リクエストの解釈と、logic が返したドメイン上の結果から HTTP レスポンスへの変換だけを
 * 担当します。ドメインの判断は `logic/liff-session.ts` にあります。
 *
 * 設定漏れ (`not-configured`) と検証失敗 (`unauthenticated`) は、サーバーの設定状態を
 * クライアントへ推測させないため、どちらも同じ 401 に落とします。
 */
export async function postLiffSession(c: Context<AppEnv>): Promise<Response> {
  const currentConfig = getConfig(c.env);

  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json({ error: "Service Unavailable" }, 503);
  }

  let idToken: string | undefined;
  try {
    const body = (await c.req.json()) as { idToken?: unknown };
    idToken = typeof body.idToken === "string" ? body.idToken : undefined;
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
      return c.json(outcome.session);
    case "account-not-found":
      return c.json({ error: "Account not found", reason: "friendship_required" }, 404);
    case "not-configured":
    case "unauthenticated":
      return c.json({ error: "Unauthorized" }, 401);
  }
}
