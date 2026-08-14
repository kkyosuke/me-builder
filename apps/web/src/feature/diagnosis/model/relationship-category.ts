import {
  type RelationshipCategory,
  relationshipCategoryValues,
} from "@me-builder/lib/diagnosis/relationship-category";
import type { DiagnosisListItem } from "./diagnosis-list-item";

export { type RelationshipCategory, relationshipCategoryValues };

export const filterableRelationshipCategoryValues = [
  "partner",
  "family",
  "friend",
  "work",
] as const satisfies readonly RelationshipCategory[];

export type FilterableRelationshipCategory = (typeof filterableRelationshipCategoryValues)[number];

const labels: Record<RelationshipCategory, string> = {
  partner: "パートナー",
  family: "家族",
  friend: "友達",
  work: "仕事",
  general: "自分自身",
};

const answerContexts: Record<RelationshipCategory, string> = {
  partner: "パートナーとの関係を思い浮かべて答えてください。",
  family: "家族との関係を思い浮かべて答えてください。",
  friend: "友達との関係を思い浮かべて答えてください。",
  work: "仕事で関わる人との関係を思い浮かべて答えてください。",
  general: "特定の相手ではなく、普段の自分を思い浮かべて答えてください。",
};

const badgeClassNames: Record<RelationshipCategory, string> = {
  partner: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  family: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  friend: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  work: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  general: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

const filterClassNames: Record<FilterableRelationshipCategory, string> = {
  partner:
    "aria-pressed:border-rose-500 aria-pressed:bg-rose-100 aria-pressed:text-rose-900 dark:aria-pressed:border-rose-500 dark:aria-pressed:bg-rose-950 dark:aria-pressed:text-rose-100",
  family:
    "aria-pressed:border-amber-500 aria-pressed:bg-amber-100 aria-pressed:text-amber-900 dark:aria-pressed:border-amber-500 dark:aria-pressed:bg-amber-950 dark:aria-pressed:text-amber-100",
  friend:
    "aria-pressed:border-emerald-500 aria-pressed:bg-emerald-100 aria-pressed:text-emerald-900 dark:aria-pressed:border-emerald-500 dark:aria-pressed:bg-emerald-950 dark:aria-pressed:text-emerald-100",
  work: "aria-pressed:border-blue-500 aria-pressed:bg-blue-100 aria-pressed:text-blue-900 dark:aria-pressed:border-blue-500 dark:aria-pressed:bg-blue-950 dark:aria-pressed:text-blue-100",
};

export function getRelationshipCategoryLabel(category: RelationshipCategory): string {
  return labels[category];
}

export function getRelationshipCategoryAnswerContext(category: RelationshipCategory): string {
  return answerContexts[category];
}

export function getRelationshipCategoryBadgeClassName(category: RelationshipCategory): string {
  return badgeClassNames[category];
}

export function getRelationshipCategoryFilterClassName(
  category: FilterableRelationshipCategory,
): string {
  return filterClassNames[category];
}

export type RelationshipCategoryFilter = "all" | FilterableRelationshipCategory;

export function relationshipCategoryFilterFromSearch(search: string): RelationshipCategoryFilter {
  const category = new URLSearchParams(search).get("category");
  return filterableRelationshipCategoryValues.some((value) => value === category)
    ? (category as FilterableRelationshipCategory)
    : "all";
}

export function diagnosisCategoryHref(category: FilterableRelationshipCategory): string {
  return `/diagnosis?category=${category}`;
}

export function filterDiagnosesByRelationshipCategory(
  diagnoses: readonly DiagnosisListItem[],
  filter: RelationshipCategoryFilter,
): DiagnosisListItem[] {
  return filter === "all"
    ? [...diagnoses]
    : diagnoses.filter(({ relationshipCategory }) => relationshipCategory === filter);
}
