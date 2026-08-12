import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  acceptCompatibilityInvitationWithReferences,
  createCompatibilityShareThemeFingerprints,
} from "@me-builder/lib";
import { loadCompatibilityInvitationAcceptanceData } from "./compatibility-invitation-preview";

type Params = Readonly<{
  relationshipId: string;
  previewToken: string;
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
  | { type: "preview-changed" }
  | { type: "share-unavailable" }
  | { type: "duplicate-relationship" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

/** 承諾直前に双方の表示を再検証し、正本と双方の一覧参照を一体で更新する。 */
export async function acceptCompatibilityInvitation(
  params: Params,
): Promise<AcceptCompatibilityInvitationOutcome> {
  const prepared = await loadCompatibilityInvitationAcceptanceData(params);
  if (prepared.type !== "resolved") return prepared;
  if (params.previewToken !== prepared.recipientData.preview.previewToken) {
    return { type: "preview-changed" };
  }
  const { invitation, recipientData } = prepared;
  if (
    !invitation.canAccept ||
    !recipientData.preview.displayName ||
    !recipientData.shareProfile ||
    prepared.recipientDiagnoses.length === 0
  ) {
    return { type: "share-unavailable" };
  }

  const acceptedThemes = await createCompatibilityShareThemeFingerprints(
    prepared.recipientDiagnoses,
  );
  const result = await acceptCompatibilityInvitationWithReferences(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    {
      inviteeAccountId: prepared.inviteeAccountId,
      inviteeDisplayName: recipientData.preview.displayName,
      acceptedProfile: {
        profileSummaryVersionId: recipientData.shareProfile.profileSummaryVersionId,
        fingerprint: recipientData.shareProfile.fingerprint,
      },
      acceptedThemes,
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
    case "invalid-themes":
    case "unavailable":
    case "unreserved":
      return { type: "unavailable" };
  }
}
