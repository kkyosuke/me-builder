import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import type {
  CompatibilitySharePreviewTheme,
  CompatibilityShareProfile,
} from "./compatibility-share-content";

export type CompatibilityRelationshipListItem =
  | {
      relationshipId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      status: "pending";
      expiresAt: string;
      invitationUrl: string;
    }
  | {
      relationshipId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      status: "accepted";
      partnerDisplayName: string;
      readiness:
        | {
            status: "ready";
            comparableThemeCount: number;
          }
        | {
            status: "waiting";
            nextAction: "diagnosis" | "profile-summary" | null;
          };
    };

export type CompatibilityRelationshipList = {
  items: CompatibilityRelationshipListItem[];
};

export type CompatibilityRelationshipPerson = {
  displayName: string;
  aboutMe: CompatibilityShareProfile;
  themes: CompatibilitySharePreviewTheme[];
};

export type CompatibilityUnavailableTheme = {
  diagnosisId: string;
  title: string;
};

export type CompatibilityPairProgression = {
  level: number;
  growthValue: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  comparableThemeCount: number;
  marks: number[];
};

export type CompatibilityRelationship =
  | {
      relationshipId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      status: "ready";
      partner: CompatibilityRelationshipPerson;
      viewer: CompatibilityRelationshipPerson;
      unavailableThemes: CompatibilityUnavailableTheme[];
      progression: CompatibilityPairProgression | null;
    }
  | {
      relationshipId: string;
      relationshipCategory: CompatibilityRelationshipCategory;
      status: "waiting";
      nextAction: "diagnosis" | "profile-summary" | null;
    };

export type CompatibilityInvitationAcceptance = {
  relationshipId: string;
  status: "accepted";
};
