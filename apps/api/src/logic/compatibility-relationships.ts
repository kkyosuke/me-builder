import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityRelationship,
  accountDataFor,
  compatibilityDataFor,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";
import { createCompatibilityInvitationUrl } from "./compatibility-invitation-url";
import { resolveCompatibilityRelationshipContents } from "./compatibility-relationship";

type CompatibilityRelationshipListItem =
  | Readonly<{
      relationshipId: string;
      relationshipCategory: CompatibilityRelationship["relationshipCategory"];
      status: "pending";
      expiresAt: string;
      invitationUrl: string;
    }>
  | Readonly<{
      relationshipId: string;
      relationshipCategory: CompatibilityRelationship["relationshipCategory"];
      status: "accepted";
      partnerDisplayName: string;
      readiness:
        | Readonly<{ status: "ready"; comparableThemeCount: number }>
        | Readonly<{
            status: "waiting";
            nextAction: "diagnosis" | "profile-summary" | null;
          }>;
    }>;

export type CompatibilityRelationshipsOutcome = {
  type: "resolved";
  items: readonly CompatibilityRelationshipListItem[];
};

type Params = Readonly<{
  actor: AuthenticatedActor;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  liffId: string;
  at?: Date;
}>;

/** AccountDataの一覧projectionを正本へ同期し、外部公開可能な最小カードへ変換する。 */
export async function listCompatibilityRelationships({
  actor,
  accountData,
  compatibilityData,
  liffId,
  at = new Date(),
}: Params): Promise<CompatibilityRelationshipsOutcome> {
  const accountId = actor.accountId;
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
              relationshipCategory: preview.relationshipCategory,
              status: "pending",
              expiresAt: preview.expiresAt.toISOString(),
              invitationUrl: createCompatibilityInvitationUrl(liffId, reference.relationshipId),
            }
          : null;
      }
      const relationship = await relationshipData.getRelationship(accountId);
      if (!relationship) return null;
      const partnerDisplayName =
        relationship.inviterAccountId === accountId
          ? relationship.inviteeDisplayName
          : relationship.inviterDisplayName;
      if (!partnerDisplayName) return null;
      const contents = await resolveCompatibilityRelationshipContents({
        canonical: relationship,
        viewerAccountId: accountId,
        accountData,
        at,
      });
      if (!contents) return null;
      return {
        relationshipId: reference.relationshipId,
        relationshipCategory: relationship.relationshipCategory,
        status: "accepted",
        partnerDisplayName,
        readiness:
          contents.status === "ready"
            ? {
                status: "ready",
                comparableThemeCount: contents.viewer.themes.length,
              }
            : {
                status: "waiting",
                nextAction: contents.nextAction,
              },
      };
    }),
  );
  return { type: "resolved", items: items.filter((item) => item !== null) };
}
