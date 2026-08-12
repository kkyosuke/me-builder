import type {
  CompatibilitySharePreviewTheme,
  CompatibilityShareProfile,
} from "./compatibility-share-content";

export type CompatibilityRelationshipListItem =
  | {
      relationshipId: string;
      status: "pending";
      expiresAt: string;
      invitationUrl: string;
    }
  | {
      relationshipId: string;
      status: "accepted";
      partnerDisplayName: string;
    };

export type CompatibilityRelationshipList = {
  items: CompatibilityRelationshipListItem[];
};

export type CompatibilityRelationshipPerson = {
  displayName: string;
  aboutMe: CompatibilityShareProfile;
  themes: CompatibilitySharePreviewTheme[];
};

export type CompatibilityRelationship =
  | {
      relationshipId: string;
      status: "ready";
      partner: CompatibilityRelationshipPerson;
      viewer: CompatibilityRelationshipPerson;
    }
  | {
      relationshipId: string;
      status: "waiting";
      nextAction: "diagnosis" | "profile-summary" | null;
    };

export type CompatibilityInvitationAcceptance = {
  relationshipId: string;
  status: "accepted";
};
