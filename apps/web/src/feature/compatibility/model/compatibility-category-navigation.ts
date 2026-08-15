import {
  type CompatibilityRelationshipCategory,
  compatibilityRelationshipCategoryValues,
} from "@me-builder/lib/compatibility";

export type CompatibilityCategoryQueryParameter = "category" | "shareCategory";

export function compatibilityCategoryFromSearch(
  search: string,
  queryParameter: CompatibilityCategoryQueryParameter,
): CompatibilityRelationshipCategory {
  const searchParameters = new URLSearchParams(search);
  const directValue = searchParameters.get(queryParameter);
  const liffState = searchParameters.get("liff.state");
  const value =
    directValue ??
    (liffState?.startsWith("/")
      ? new URL(liffState, "https://liff.local").searchParams.get(queryParameter)
      : null);
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
