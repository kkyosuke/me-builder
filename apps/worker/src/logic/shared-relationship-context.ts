import { accountDataFor, compatibilityDataFor } from "@me-builder/lib";
import type { CompatibilityRelationshipCategory } from "@me-builder/lib";
import type { CloudflareBindings } from "../config";

const SHARED_RELATIONSHIP_CONTEXT_LIMIT = 10;

/** 相性共有からチャットへ渡せる、相手側コンテンツを含まない人物照合用metadata。 */
export type SharedRelationshipContext = Readonly<{
  relationshipCategory: CompatibilityRelationshipCategory;
  partnerDisplayName: string;
}>;

/**
 * activeな相性共有を正本へ照合し、表示名とRelationship Categoryだけへ射影する。
 * Account ID、診断、Brain Item、共有projectionは返さない。
 */
export async function loadSharedRelationshipContexts(
  cf: CloudflareBindings,
  accountId: string,
): Promise<readonly SharedRelationshipContext[]> {
  const accountData = cf.do.accountData;
  const compatibilityData = cf.do.compatibilityData;
  if (!accountData || !compatibilityData) return [];

  const references = await accountDataFor(accountData, accountId).execute(
    "compatibility.listVisibleReferences",
  );
  const active = references
    .filter(({ status }) => status === "active")
    .slice(0, SHARED_RELATIONSHIP_CONTEXT_LIMIT);
  const relationships = await Promise.all(
    active.map(({ relationshipId }) =>
      compatibilityDataFor(compatibilityData, relationshipId).getRelationship(accountId),
    ),
  );

  return relationships.flatMap((relationship) => {
    if (!relationship || relationship.status !== "accepted") return [];
    const partnerDisplayName =
      relationship.inviterAccountId === accountId
        ? relationship.inviteeDisplayName
        : relationship.inviterDisplayName;
    if (!partnerDisplayName?.trim()) return [];
    return [
      {
        relationshipCategory: relationship.relationshipCategory,
        partnerDisplayName: partnerDisplayName.trim(),
      },
    ];
  });
}
