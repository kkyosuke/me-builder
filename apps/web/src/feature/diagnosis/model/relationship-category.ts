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

const badgeClassNames: Record<RelationshipCategory, string> = {
  partner: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  family: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  friend: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  work: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  other: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  general: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

const filterClassNames: Record<RelationshipCategory, string> = {
  partner:
    "aria-pressed:border-rose-500 aria-pressed:bg-rose-100 aria-pressed:text-rose-900 dark:aria-pressed:border-rose-500 dark:aria-pressed:bg-rose-950 dark:aria-pressed:text-rose-100",
  family:
    "aria-pressed:border-amber-500 aria-pressed:bg-amber-100 aria-pressed:text-amber-900 dark:aria-pressed:border-amber-500 dark:aria-pressed:bg-amber-950 dark:aria-pressed:text-amber-100",
  friend:
    "aria-pressed:border-emerald-500 aria-pressed:bg-emerald-100 aria-pressed:text-emerald-900 dark:aria-pressed:border-emerald-500 dark:aria-pressed:bg-emerald-950 dark:aria-pressed:text-emerald-100",
  work: "aria-pressed:border-blue-500 aria-pressed:bg-blue-100 aria-pressed:text-blue-900 dark:aria-pressed:border-blue-500 dark:aria-pressed:bg-blue-950 dark:aria-pressed:text-blue-100",
  other:
    "aria-pressed:border-violet-500 aria-pressed:bg-violet-100 aria-pressed:text-violet-900 dark:aria-pressed:border-violet-500 dark:aria-pressed:bg-violet-950 dark:aria-pressed:text-violet-100",
  general:
    "aria-pressed:border-slate-500 aria-pressed:bg-slate-100 aria-pressed:text-slate-900 dark:aria-pressed:border-slate-500 dark:aria-pressed:bg-slate-700 dark:aria-pressed:text-slate-100",
};

export function getRelationshipCategoryLabel(category: RelationshipCategory): string {
  return labels[category];
}

export function getRelationshipCategoryBadgeClassName(category: RelationshipCategory): string {
  return badgeClassNames[category];
}

export function getRelationshipCategoryFilterClassName(category: RelationshipCategory): string {
  return filterClassNames[category];
}

export type RelationshipCategoryFilter = "all" | RelationshipCategory;

export function filterDiagnosesByRelationshipCategory(
  diagnoses: readonly DiagnosisListItem[],
  filter: RelationshipCategoryFilter,
): DiagnosisListItem[] {
  return filter === "all"
    ? [...diagnoses]
    : diagnoses.filter(({ relationshipCategory }) => relationshipCategory === filter);
}
