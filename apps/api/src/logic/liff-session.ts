import { D1, line } from "@me-builder/lib";
import { logger, resolveLineAccountRole } from "@me-builder/shared";

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
  db: D1.shared.Client;
  adminLineUserIds?: readonly string[];
};

/** 表示に使ってよい情報だけを持つ、解決済みのセッション。 */
type ResolvedLiffSession = {
  accountId: string;
  role: "user" | "admin";
  displayName?: string | undefined;
  pictureUrl?: string | undefined;
};

export type LiffSessionOutcome =
  /** ID トークンを検証でき、Account を解決できた */
  | { type: "resolved"; session: ResolvedLiffSession }
  /** LINE Login チャネル ID が未設定で検証そのものができない（サーバー側の設定漏れ） */
  | { type: "not-configured" }
  /** ID トークンが無い、または検証に失敗した */
  | { type: "unauthenticated"; reason: string };

/** 本人確認とAccount解決だけを行う。規約取得・同意API以外から直接呼ばない。 */
export async function resolveLiffSession({
  idToken,
  lineLoginChannelId,
  db,
  adminLineUserIds = [],
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

  const resolved = await D1.shared.action.account.resolveAccountByLineLogin(
    db,
    verified.claims.sub,
    resolveLineAccountRole(verified.claims.sub, adminLineUserIds),
  );

  logger.info("Resolved account for the LIFF session");

  return {
    type: "resolved",
    session: {
      accountId: resolved.account.id,
      role: resolved.account.role,
      displayName: verified.claims.name,
      pictureUrl: verified.claims.picture,
    },
  };
}

/** 本人機能用のセッション。現在の同意要件を満たさないAccountは解決済みとして返さない。 */
export async function createLiffSession(params: LiffSessionParams): Promise<LiffSessionOutcome> {
  const outcome = await resolveLiffSession(params);
  if (outcome.type !== "resolved") return outcome;
  const accepted = await D1.shared.action.agreement.hasAcceptedCurrentTerms(
    params.db,
    outcome.session.accountId,
  );
  if (!accepted) {
    logger.info("Rejected LIFF feature access until the current terms are accepted");
    return { type: "unauthenticated", reason: "terms_not_accepted" };
  }
  return outcome;
}
