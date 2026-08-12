import type {
  CompatibilitySharePreviewBlockingReason,
  CompatibilitySharePreviewTheme,
  CompatibilityShareProfile,
} from "./compatibility-share-preview";

export type CompatibilityInvitationPreviewBlockingReason =
  | CompatibilitySharePreviewBlockingReason
  | "common_diagnosis_required";

export type CompatibilityInvitationPreview = {
  inviter: {
    displayName: string;
    aboutMe: CompatibilityShareProfile;
    themes: CompatibilitySharePreviewTheme[];
  };
  recipient: {
    displayName: string | null;
    previewToken: string;
    aboutMe: CompatibilityShareProfile | null;
    themes: CompatibilitySharePreviewTheme[];
  };
  expiresAt: string;
  canAccept: boolean;
  blockingReasons: CompatibilityInvitationPreviewBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
};
