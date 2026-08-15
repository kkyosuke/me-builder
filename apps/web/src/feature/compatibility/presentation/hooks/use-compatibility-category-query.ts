import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { useCallback, useEffect, useState } from "react";
import {
  type CompatibilityCategoryQueryParameter,
  compatibilityCategoryFromSearch,
} from "../../model/compatibility-category-navigation";

export function useCompatibilityCategoryQuery(queryParameter: CompatibilityCategoryQueryParameter) {
  const [relationshipCategory, setRelationshipCategory] =
    useState<CompatibilityRelationshipCategory>(() =>
      compatibilityCategoryFromSearch(window.location.search, queryParameter),
    );

  useEffect(() => {
    const syncWithHistory = () =>
      setRelationshipCategory(
        compatibilityCategoryFromSearch(window.location.search, queryParameter),
      );
    window.addEventListener("popstate", syncWithHistory);
    return () => window.removeEventListener("popstate", syncWithHistory);
  }, [queryParameter]);

  const changeRelationshipCategory = useCallback(
    (category: CompatibilityRelationshipCategory) => {
      setRelationshipCategory(category);
      const url = new URL(window.location.href);
      url.searchParams.set(queryParameter, category);
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    },
    [queryParameter],
  );

  return { relationshipCategory, changeRelationshipCategory };
}
