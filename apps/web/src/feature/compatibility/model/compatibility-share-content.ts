type CompatibilitySharePreviewParameter = {
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
