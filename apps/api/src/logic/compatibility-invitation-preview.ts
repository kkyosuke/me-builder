import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityInvitationPreview,
  type D1,
  compatibilityDataFor,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import { loadCompatibilitySharePreviewData } from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

type CompatibilityInvitationBlockingReason = "display_name_unavailable";

/** 受信者が承諾前に見るのは、招待者が誰かと自分が共有を始められるかだけ。 */
type CompatibilityInvitationContents = Readonly<{
  inviter: Readonly<{ displayName: string; avatarUrl: string | null }>;
  recipient: Readonly<{ displayName: string | null; avatarUrl: string | null }>;
  expiresAt: string;
  canAccept: boolean;
  blockingReasons: readonly CompatibilityInvitationBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
}>;

export type CompatibilityInvitationPreviewOutcome =
  | { type: "resolved"; invitation: CompatibilityInvitationContents }
  | { type: "unavailable" }
  | { type: "own-invitation" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = Readonly<{
  relationshipId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  at?: Date;
}>;

type Dependencies = Readonly<{
  createSession: typeof createLiffSession;
  getInvitationPreview: (
    namespace: CompatibilityDataNamespace,
    relationshipId: string,
    viewerAccountId: string,
  ) => Promise<CompatibilityInvitationPreview | null>;
  loadSharePreviewData: typeof loadCompatibilitySharePreviewData;
}>;

/** 承諾に必要なのは、pending招待の当事者と相手へ固定する表示名だけ。 */
type CompatibilityInvitationRecipientOutcome =
  | {
      type: "resolved";
      inviteeAccountId: string;
      inviteeDisplayName: string | null;
      inviterDisplayName: string;
      expiresAt: Date;
    }
  | Exclude<CompatibilityInvitationPreviewOutcome, { type: "resolved" }>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  getInvitationPreview: (namespace, relationshipId, viewerAccountId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationPreview(viewerAccountId),
  loadSharePreviewData: loadCompatibilitySharePreviewData,
};

/** 本人確認とpending招待の判定だけを行い、AccountDataを読まない。 */
async function resolveCompatibilityInvitationRecipient(
  { relationshipId, idToken, lineLoginChannelId, db, compatibilityData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationRecipientOutcome> {
  if (!compatibilityRelationshipId.isValid(relationshipId)) return { type: "unavailable" };
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const preview = await dependencies.getInvitationPreview(
    compatibilityData,
    relationshipId,
    session.session.accountId,
  );
  if (!preview) return { type: "unavailable" };
  if (preview.isOwnInvitation) return { type: "own-invitation" };

  return {
    type: "resolved",
    inviteeAccountId: session.session.accountId,
    inviteeDisplayName: session.session.displayName?.trim() || null,
    inviterDisplayName: preview.inviterDisplayName,
    expiresAt: preview.expiresAt,
  };
}

/** pending招待から、HTTPへ公開してよい確認表示だけを返す。 */
export async function getCompatibilityInvitationContents(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationPreviewOutcome> {
  const recipient = await resolveCompatibilityInvitationRecipient(params, dependencies);
  if (recipient.type !== "resolved") return recipient;

  // 案内（nextAction）のためだけに本人の共有内容を読む。承諾可否には影響しない。
  const recipientData = await dependencies.loadSharePreviewData({
    accountId: recipient.inviteeAccountId,
    verifiedDisplayName: recipient.inviteeDisplayName ?? undefined,
    accountData: params.accountData,
    at: params.at ?? new Date(),
  });
  const blockingReasons: CompatibilityInvitationBlockingReason[] =
    recipient.inviteeDisplayName === null ? ["display_name_unavailable"] : [];

  return {
    type: "resolved",
    invitation: {
      inviter: {
        displayName: recipient.inviterDisplayName,
        avatarUrl: `/api/compatibility/invitations/${encodeURIComponent(params.relationshipId)}/avatar`,
      },
      recipient: {
        displayName: recipient.inviteeDisplayName,
        avatarUrl: "/api/profile/avatar",
      },
      expiresAt: recipient.expiresAt.toISOString(),
      canAccept: blockingReasons.length === 0,
      blockingReasons,
      nextAction: recipientData.nextAction,
    },
  };
}
