import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";

export type CompatibilityInvitation = {
  invitationUrl: string;
  expiresAt: string;
  relationshipCategory: CompatibilityRelationshipCategory;
};
