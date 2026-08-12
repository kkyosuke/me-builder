import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  acceptCompatibilityInvitationWithReferences,
} from "@me-builder/lib";
import { loadCompatibilityInvitationAcceptanceData } from "./compatibility-invitation-preview";

type Params = Readonly<{
  relationshipId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  at?: Date;
}>;

export type AcceptCompatibilityInvitationOutcome =
  | { type: "accepted"; relationshipId: string }
  | { type: "unavailable" }
  | { type: "own-invitation" }
  | { type: "share-unavailable" }
  | { type: "duplicate-relationship" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

/** 受信者の共有同意を、正本と双方の一覧参照へ一体で反映する。 */
export async function acceptCompatibilityInvitation(
  params: Params,
): Promise<AcceptCompatibilityInvitationOutcome> {
  const prepared = await loadCompatibilityInvitationAcceptanceData(params);
  if (prepared.type !== "resolved") return prepared;
  const { invitation, recipientData } = prepared;
  if (!invitation.canAccept || !recipientData.displayName) return { type: "share-unavailable" };

  const result = await acceptCompatibilityInvitationWithReferences(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    {
      inviteeAccountId: prepared.inviteeAccountId,
      inviteeDisplayName: recipientData.displayName,
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
