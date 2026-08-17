import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  cancelCompatibilityInvitationWithReference,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Params = Readonly<{
  relationshipId: string;
  actor: AuthenticatedActor;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
}>;

export type CancelCompatibilityInvitationOutcome = { type: "cancelled" } | { type: "unavailable" };

/** 本人確認後に正本と送信者の一覧参照を取り消す。 */
export async function cancelCompatibilityInvitation(
  params: Params,
): Promise<CancelCompatibilityInvitationOutcome> {
  if (!compatibilityRelationshipId.isValid(params.relationshipId)) return { type: "unavailable" };
  const result = await cancelCompatibilityInvitationWithReference(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    params.actor.accountId,
  );
  return result.outcome === "cancelled" || result.outcome === "unchanged"
    ? { type: "cancelled" }
    : { type: "unavailable" };
}
