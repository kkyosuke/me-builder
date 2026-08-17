import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityRelationshipCategory,
  createCompatibilityInvitationWithReference,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";
import { createCompatibilityInvitationUrl } from "./compatibility-invitation-url";

export type CompatibilityInvitationIssueOutcome =
  | Readonly<{
      type: "created";
      invitationUrl: string;
      expiresAt: string;
      relationshipCategory: CompatibilityRelationshipCategory;
    }>
  | Readonly<{ type: "share-unavailable" }>;

type Params = Readonly<{
  actor: AuthenticatedActor;
  verifiedDisplayName?: string;
  liffId: string;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  relationshipCategory: CompatibilityRelationshipCategory;
}>;

type Dependencies = Readonly<{
  createInvitation: typeof createCompatibilityInvitationWithReference;
}>;

const defaultDependencies: Dependencies = {
  createInvitation: createCompatibilityInvitationWithReference,
};

/** 本人が共有へ同意した時点の表示名だけを固定し、1人用の招待を発行する。 */
export async function issueCompatibilityInvitation(
  {
    actor,
    verifiedDisplayName,
    liffId,
    accountData,
    compatibilityData,
    relationshipCategory,
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationIssueOutcome> {
  // 共有対象は関係の成立後に自動で最新化されるため、発行時に固定するのは表示名だけ。
  const inviterDisplayName = verifiedDisplayName?.trim();
  if (!inviterDisplayName) return { type: "share-unavailable" };

  const result = await dependencies.createInvitation(accountData, compatibilityData, {
    inviterAccountId: actor.accountId,
    inviterDisplayName,
    relationshipCategory,
  });
  const invitationUrl = createCompatibilityInvitationUrl(liffId, result.relationship.id);
  return {
    type: "created",
    invitationUrl,
    expiresAt: result.relationship.expiresAt.toISOString(),
    relationshipCategory: result.relationship.relationshipCategory,
  };
}
