import {
  type RelationshipCategory,
  relationshipCategoryValues,
} from "@me-builder/lib/diagnosis/relationship-category";
import type { DiagnosisListItem } from "./diagnosis-list-item";

export { type RelationshipCategory, relationshipCategoryValues };

const labels: Record<RelationshipCategory, string> = {
  partner: "パートナー",
  family: "家族",
  friend: "友達",
  work: "仕事",
  other: "その他",
  general: "人間関係全般",
};

export function getRelationshipCategoryLabel(category: RelationshipCategory): string {
  return labels[category];
}

export type RelationshipCategoryFilter = "all" | RelationshipCategory;

export function availableRelationshipCategories(
  diagnoses: readonly DiagnosisListItem[],
): RelationshipCategory[] {
  const available = new Set(diagnoses.map(({ relationshipCategory }) => relationshipCategory));
  return relationshipCategoryValues.filter((category) => available.has(category));
}

export function filterDiagnosesByRelationshipCategory(
  diagnoses: readonly DiagnosisListItem[],
  filter: RelationshipCategoryFilter,
): DiagnosisListItem[] {
  return filter === "all"
    ? [...diagnoses]
    : diagnoses.filter(({ relationshipCategory }) => relationshipCategory === filter);
}
