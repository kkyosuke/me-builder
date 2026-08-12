import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityInvitationPreview,
  type D1,
  compatibilityDataFor,
} from "@me-builder/lib";
import {
  type CompatibilitySharePreviewData,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

const RELATIONSHIP_ID_PATTERN = /^[a-f0-9]{64}$/;

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

export type CompatibilityInvitationAcceptanceDataOutcome =
  | {
      type: "resolved";
      invitation: CompatibilityInvitationContents;
      inviteeAccountId: string;
      recipientData: CompatibilitySharePreviewData;
    }
  | Exclude<CompatibilityInvitationPreviewOutcome, { type: "resolved" }>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  getInvitationPreview: (namespace, relationshipId, viewerAccountId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationPreview(viewerAccountId),
  loadSharePreviewData: loadCompatibilitySharePreviewData,
};

/** pending招待と受信者の現在状態から、保存を伴わない承諾前の確認表示を組み立てる。 */
export async function loadCompatibilityInvitationAcceptanceData(
  {
    relationshipId,
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    compatibilityData,
    at = new Date(),
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationAcceptanceDataOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  if (!RELATIONSHIP_ID_PATTERN.test(relationshipId)) return { type: "unavailable" };

  const preview = await dependencies.getInvitationPreview(
    compatibilityData,
    relationshipId,
    session.session.accountId,
  );
  if (!preview) return { type: "unavailable" };
  if (preview.isOwnInvitation) return { type: "own-invitation" };

  const recipientData = await dependencies.loadSharePreviewData({
    accountId: session.session.accountId,
    verifiedDisplayName: session.session.displayName,
    accountData,
    at,
  });
  const blockingReasons: CompatibilityInvitationBlockingReason[] =
    recipientData.displayName === null ? ["display_name_unavailable"] : [];

  return {
    type: "resolved",
    invitation: {
      inviter: { displayName: preview.inviterDisplayName, avatarUrl: null },
      recipient: { displayName: recipientData.displayName, avatarUrl: null },
      expiresAt: preview.expiresAt.toISOString(),
      canAccept: blockingReasons.length === 0,
      blockingReasons,
      nextAction: recipientData.nextAction,
    },
    inviteeAccountId: session.session.accountId,
    recipientData,
  };
}

/** pending招待から、HTTPへ公開してよい確認表示だけを返す。 */
export async function getCompatibilityInvitationContents(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationPreviewOutcome> {
  const outcome = await loadCompatibilityInvitationAcceptanceData(params, dependencies);
  if (outcome.type !== "resolved") return outcome;
  return {
    type: "resolved",
    invitation: {
      ...outcome.invitation,
      inviter: {
        ...outcome.invitation.inviter,
        avatarUrl: `/api/compatibility/invitations/${encodeURIComponent(params.relationshipId)}/avatar`,
      },
      recipient: { ...outcome.invitation.recipient, avatarUrl: "/api/profile/avatar" },
    },
  };
}
