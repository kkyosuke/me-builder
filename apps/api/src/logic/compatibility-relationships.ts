import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  accountDataFor,
  compatibilityDataFor,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type CompatibilityRelationshipListItem =
  | Readonly<{ relationshipId: string; status: "pending"; expiresAt: string }>
  | Readonly<{
      relationshipId: string;
      status: "accepted";
      partnerDisplayName: string;
    }>;

export type CompatibilityRelationshipsOutcome =
  | { type: "resolved"; items: readonly CompatibilityRelationshipListItem[] }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
}>;

/** AccountDataの一覧projectionを正本へ同期し、外部公開可能な最小カードへ変換する。 */
export async function listCompatibilityRelationships({
  idToken,
  lineLoginChannelId,
  db,
  accountData,
  compatibilityData,
}: Params): Promise<CompatibilityRelationshipsOutcome> {
  const session = await createLiffSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  const accountId = session.session.accountId;
  const references = await accountDataFor(accountData, accountId).execute(
    "compatibility.listVisibleReferences",
  );
  const items = await Promise.all(
    references.map(async (reference): Promise<CompatibilityRelationshipListItem | null> => {
      const relationshipData = compatibilityDataFor(compatibilityData, reference.relationshipId);
      if (reference.status === "pending") {
        const preview = await relationshipData.getInvitationPreview(accountId);
        return preview
          ? {
              relationshipId: reference.relationshipId,
              status: "pending",
              expiresAt: preview.expiresAt.toISOString(),
            }
          : null;
      }
      const relationship = await relationshipData.getRelationship(accountId);
      if (!relationship) return null;
      const partnerDisplayName =
        relationship.inviterAccountId === accountId
          ? relationship.inviteeDisplayName
          : relationship.inviterDisplayName;
      return partnerDisplayName
        ? {
            relationshipId: reference.relationshipId,
            status: "accepted",
            partnerDisplayName,
          }
        : null;
    }),
  );
  return { type: "resolved", items: items.filter((item) => item !== null) };
}
