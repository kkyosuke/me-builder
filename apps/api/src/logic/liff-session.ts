import { d1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";

/**
 * LIFF の ID トークンを検証し、対応する Account を解決します。
 *
 * クライアントが自称する `liff.getProfile()` の結果は信頼せず、検証で得た `sub` だけを
 * 本人の識別子として使います。`sub` と ID トークンはレスポンスにもログにも含めません
 * ([プロジェクト概要 §8](../../../../docs/project-overview.md#8-プライバシーと安全性))。
 */

export type LiffSessionParams = {
  idToken: string | undefined;
  /** LINE Login チャネル ID (ID トークンの `aud` の期待値) */
  lineLoginChannelId: string | undefined;
  db: d1.Client;
};

export type LiffSessionResult =
  | {
      status: 200;
      body: {
        accountId: string;
        displayName?: string | undefined;
        pictureUrl?: string | undefined;
      };
    }
  | { status: 401; body: { error: string } }
  | { status: 404; body: { error: string; reason: string } };

export async function createLiffSession({
  idToken,
  lineLoginChannelId,
  db,
}: LiffSessionParams): Promise<LiffSessionResult> {
  if (!lineLoginChannelId) {
    logger.error("LINE Login channel id is not configured, rejecting LIFF session request");
    return { status: 401, body: { error: "Unauthorized" } };
  }

  if (!idToken) {
    logger.warn("LIFF session request without an id token");
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const verified = await line.idToken.verify({ idToken, channelId: lineLoginChannelId });

  if (!verified.ok) {
    logger.warn(
      { reason: verified.reason },
      "Rejected LIFF session request with an invalid id token",
    );
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const resolved = await d1.action.account.resolveAccountByLineLogin(db, verified.claims.sub);

  if (!resolved) {
    // アカウント作成の起点は LINE 公式アカウントの友だち追加
    // ([プロジェクト概要 §5](../../../../docs/project-overview.md#5-アカウントと本人識別))。
    // Messaging API と LINE Login で userId が一致しない構成での紐づけ手段は別途設計する。
    logger.info("No account found for the verified LINE Login identity");
    return { status: 404, body: { error: "Account not found", reason: "friendship_required" } };
  }

  logger.info({ accountId: resolved.account.id }, "Resolved account for the LIFF session");

  return {
    status: 200,
    body: {
      accountId: resolved.account.id,
      displayName: verified.claims.name,
      pictureUrl: verified.claims.picture,
    },
  };
}
