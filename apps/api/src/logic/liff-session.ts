import { d1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";

/**
 * LIFF の ID トークンを検証し、対応する Account を解決します。
 *
 * クライアントから送られてきたプロフィールは（値そのものが本物であっても）サーバー側では
 * 検証できないため、識別子としては受け付けません。本人の識別子は検証で得た `sub` だけを
 * 使います。`sub` と ID トークンは戻り値にもログにも含めません
 * ([プロジェクト概要 §8](../../../../docs/product/project-overview.md#8-プライバシーと安全性))。
 *
 * この層は HTTP を知りません。ステータスコードへの変換は controller が行います。
 */

export type LiffSessionParams = {
  idToken: string | undefined;
  /** LINE Login チャネル ID (ID トークンの `aud` の期待値) */
  lineLoginChannelId: string | undefined;
  db: d1.Client;
};

/** 表示に使ってよい情報だけを持つ、解決済みのセッション。 */
type ResolvedLiffSession = {
  accountId: string;
  displayName?: string | undefined;
  pictureUrl?: string | undefined;
};

export type LiffSessionOutcome =
  /** ID トークンを検証でき、Account を解決できた */
  | { type: "resolved"; session: ResolvedLiffSession }
  /** LINE Login チャネル ID が未設定で検証そのものができない（サーバー側の設定漏れ） */
  | { type: "not-configured" }
  /** ID トークンが無い、または検証に失敗した */
  | { type: "unauthenticated"; reason: string }
  /** 検証はできたが、対応する Account が存在しない */
  | { type: "account-not-found" };

export async function createLiffSession({
  idToken,
  lineLoginChannelId,
  db,
}: LiffSessionParams): Promise<LiffSessionOutcome> {
  if (!lineLoginChannelId) {
    logger.error("LINE Login channel id is not configured, cannot verify the id token");
    return { type: "not-configured" };
  }

  if (!idToken) {
    logger.warn("LIFF session request without an id token");
    return { type: "unauthenticated", reason: "id_token がありません" };
  }

  const verified = await line.idToken.verify({ idToken, channelId: lineLoginChannelId });

  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, "Rejected an invalid id token");
    return { type: "unauthenticated", reason: verified.reason };
  }

  const resolved = await d1.action.account.resolveAccountByLineLogin(db, verified.claims.sub);

  if (!resolved) {
    // アカウント作成の起点は LINE 公式アカウントの友だち追加
    // ([プロジェクト概要 §5](../../../../docs/product/project-overview.md#5-アカウントと本人識別))。
    // Messaging API と LINE Login で userId が一致しない構成での紐づけ手段は別途設計する。
    logger.info("No account found for the verified LINE Login identity");
    return { type: "account-not-found" };
  }

  logger.info("Resolved account for the LIFF session");

  return {
    type: "resolved",
    session: {
      accountId: resolved.account.id,
      displayName: verified.claims.name,
      pictureUrl: verified.claims.picture,
    },
  };
}
