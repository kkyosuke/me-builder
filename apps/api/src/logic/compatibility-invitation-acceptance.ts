import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  acceptCompatibilityInvitationWithReferences,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Params = Readonly<{
  relationshipId: string;
  actor: AuthenticatedActor;
  verifiedDisplayName?: string;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
}>;

type Dependencies = Readonly<{
  acceptInvitation: typeof acceptCompatibilityInvitationWithReferences;
}>;

const defaultDependencies: Dependencies = {
  acceptInvitation: acceptCompatibilityInvitationWithReferences,
};

export type AcceptCompatibilityInvitationOutcome =
  | { type: "accepted"; relationshipId: string }
  | { type: "unavailable" }
  | { type: "own-invitation" }
  | { type: "share-unavailable" }
  | { type: "duplicate-relationship" };

/**
 * 受信者の共有同意を、正本と双方の一覧参照へ一体で反映する。
 * 共有対象は成立後に自動で最新化されるため、固定するのは表示名だけ。
 */
export async function acceptCompatibilityInvitation(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<AcceptCompatibilityInvitationOutcome> {
  if (!compatibilityRelationshipId.isValid(params.relationshipId)) return { type: "unavailable" };
  const inviteeDisplayName = params.verifiedDisplayName?.trim();
  if (!inviteeDisplayName) return { type: "share-unavailable" };

  const result = await dependencies.acceptInvitation(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    {
      inviteeAccountId: params.actor.accountId,
      inviteeDisplayName,
    },
  );

  switch (result.outcome) {
    case "accepted":
    case "unchanged":
      return { type: "accepted", relationshipId: params.relationshipId };
    case "duplicate":
      return { type: "duplicate-relationship" };
    case "self-invite":
      return { type: "own-invitation" };
    case "expired":
    case "unavailable":
    case "unreserved":
      return { type: "unavailable" };
  }
}
