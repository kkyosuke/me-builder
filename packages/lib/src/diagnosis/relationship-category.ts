/** Diagnosisを作る段階で固定する、回答対象との関係カテゴリ。 */
export const relationshipCategoryValues = [
  "partner",
  "family",
  "friend",
  "work",
  "other",
  "general",
] as const;

export type RelationshipCategory = (typeof relationshipCategoryValues)[number];

export function isRelationshipCategory(value: unknown): value is RelationshipCategory {
  return relationshipCategoryValues.some((category) => category === value);
}
