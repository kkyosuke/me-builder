import {
  type CompatibilityRelationshipCategory,
  compatibilityRelationshipCategoryValues,
} from "@me-builder/lib/compatibility";

export type CompatibilityCategoryQueryParameter = "category" | "shareCategory";

export function compatibilityCategoryFromSearch(
  search: string,
  queryParameter: CompatibilityCategoryQueryParameter,
): CompatibilityRelationshipCategory {
  const value = new URLSearchParams(search).get(queryParameter);
  return (
    compatibilityRelationshipCategoryValues.find((category) => category === value) ?? "partner"
  );
}

export function compatibilityShareContentHref(
  relationshipCategory: CompatibilityRelationshipCategory,
): string {
  const search = new URLSearchParams({ shareCategory: relationshipCategory });
  return `/me?${search.toString()}`;
}
