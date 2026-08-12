export type CompatibilitySharePreviewBlockingReason =
  | "display_name_unavailable"
  | "profile_summary_required"
  | "profile_summary_stale"
  | "diagnosis_required"
  | "scoring_unavailable"
  | "diagnosis_unavailable";

export type CompatibilitySharePreviewParameter = {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  position: number;
  statement: string;
};

export type CompatibilitySharePreviewTheme = {
  diagnosisId: string;
  title: string;
  parameters: CompatibilitySharePreviewParameter[];
};

export type CompatibilityShareProfile = {
  profileSummaryVersionId: string;
  generatedAt: string;
  statements: Array<{ key: string; label: string; statement: string }>;
};

/** 招待を発行する前に、本人へ開示する内容と発行可否を示す。 */
export type CompatibilitySharePreview = {
  displayName: string | null;
  previewToken: string;
  aboutMe: CompatibilityShareProfile | null;
  themes: CompatibilitySharePreviewTheme[];
  canIssueInvitation: boolean;
  blockingReasons: CompatibilitySharePreviewBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
};
