export type CompatibilitySharePreviewBlockingReason =
  | "display_name_unavailable"
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

type CompatibilitySharePreviewTheme = {
  diagnosisId: string;
  title: string;
  parameters: CompatibilitySharePreviewParameter[];
};

/** 招待を発行する前に、本人へ開示する内容と発行可否を示す。 */
export type CompatibilitySharePreview = {
  displayName: string | null;
  previewToken: string;
  themes: CompatibilitySharePreviewTheme[];
  canIssueInvitation: boolean;
  blockingReasons: CompatibilitySharePreviewBlockingReason[];
  nextAction: "diagnosis" | null;
};
