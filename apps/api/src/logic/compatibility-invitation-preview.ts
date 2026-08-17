import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityInvitationPreview,
  type CompatibilityRelationshipCategory,
  compatibilityDataFor,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";
import { loadCompatibilitySharePreviewData } from "./compatibility-share-preview";

type CompatibilityInvitationBlockingReason = "display_name_unavailable";

/** 受信者が承諾前に見るのは、招待者が誰かと自分が共有を始められるかだけ。 */
type CompatibilityInvitationContents = Readonly<{
  relationshipCategory: CompatibilityRelationshipCategory;
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
  | { type: "own-invitation" };

type Params = Readonly<{
  relationshipId: string;
  actor: AuthenticatedActor;
  verifiedDisplayName?: string;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  at?: Date;
}>;

type Dependencies = Readonly<{
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
      relationshipCategory: CompatibilityRelationshipCategory;
      expiresAt: Date;
    }
  | Exclude<CompatibilityInvitationPreviewOutcome, { type: "resolved" }>;

const defaultDependencies: Dependencies = {
  getInvitationPreview: (namespace, relationshipId, viewerAccountId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationPreview(viewerAccountId),
  loadSharePreviewData: loadCompatibilitySharePreviewData,
};

/** 本人確認とpending招待の判定だけを行い、AccountDataを読まない。 */
async function resolveCompatibilityInvitationRecipient(
  { relationshipId, actor, verifiedDisplayName, compatibilityData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationRecipientOutcome> {
  if (!compatibilityRelationshipId.isValid(relationshipId)) return { type: "unavailable" };
  const preview = await dependencies.getInvitationPreview(
    compatibilityData,
    relationshipId,
    actor.accountId,
  );
  if (!preview) return { type: "unavailable" };
  if (preview.isOwnInvitation) return { type: "own-invitation" };

  return {
    type: "resolved",
    inviteeAccountId: actor.accountId,
    inviteeDisplayName: verifiedDisplayName?.trim() || null,
    inviterDisplayName: preview.inviterDisplayName,
    relationshipCategory: preview.relationshipCategory,
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
    relationshipCategory: recipient.relationshipCategory,
  });
  const blockingReasons: CompatibilityInvitationBlockingReason[] =
    recipient.inviteeDisplayName === null ? ["display_name_unavailable"] : [];

  return {
    type: "resolved",
    invitation: {
      relationshipCategory: recipient.relationshipCategory,
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
