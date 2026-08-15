type CompatibilitySharePreviewParameter = {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  position: number;
  statement: string;
  request?: string | undefined;
  band: "low" | "balanced" | "high";
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

export type CompatibilityShareContent = {
  relationshipCategory: CompatibilityRelationshipCategory;
  aboutMe: CompatibilityShareProfile | null;
  themes: CompatibilitySharePreviewTheme[];
  nextAction: "diagnosis" | "profile-summary" | null;
};
import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
