import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { fetchCompatibilityShareContent } from "../../infrastructure/compatibility-api";
import type { CompatibilityShareContent } from "../../model/compatibility-share-content";
import { useCompatibilityCategoryQuery } from "./use-compatibility-category-query";

export function useCompatibilityShareContent({
  acquireIdToken,
  latestProfileSummaryVersionId,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  latestProfileSummaryVersionId: string | null | undefined;
}) {
  const { relationshipCategory, changeRelationshipCategory: changeCategoryQuery } =
    useCompatibilityCategoryQuery("shareCategory");
  const [state, setState] = useState<AsyncState<CompatibilityShareContent>>({
    status: "loading",
  });
  const cache = useRef<
    Partial<Record<CompatibilityRelationshipCategory, CompatibilityShareContent>>
  >({});
  const cachedProfileSummaryVersionId = useRef(latestProfileSummaryVersionId);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(
    async (category: CompatibilityRelationshipCategory, force = false) => {
      const cached = cache.current[category];
      if (cached && !force) {
        request.current?.abort();
        setState({ status: "success", data: cached });
        return;
      }

      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (!cached) setState({ status: "loading" });
      try {
        const idToken = await acquireIdToken(controller.signal);
        if (controller.signal.aborted) return;
        if (!idToken) throw new Error("LINEから「わたし」を開いてください。");
        const content = await fetchCompatibilityShareContent(
          config.apiUrl,
          idToken,
          category,
          controller.signal,
        );
        if (controller.signal.aborted || request.current !== controller) return;
        cache.current[category] = content;
        setState({ status: "success", data: content });
      } catch (error) {
        if (controller.signal.aborted || request.current !== controller) return;
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "共有される内容を読み込めませんでした。",
        });
      }
    },
    [acquireIdToken],
  );

  useEffect(() => {
    const profileSummaryChanged =
      latestProfileSummaryVersionId !== undefined &&
      cachedProfileSummaryVersionId.current !== undefined &&
      cachedProfileSummaryVersionId.current !== latestProfileSummaryVersionId;
    if (profileSummaryChanged) {
      cache.current = {};
    }
    if (latestProfileSummaryVersionId !== undefined) {
      cachedProfileSummaryVersionId.current = latestProfileSummaryVersionId;
    }
    void load(relationshipCategory, profileSummaryChanged);
  }, [latestProfileSummaryVersionId, load, relationshipCategory]);

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  const changeRelationshipCategory = useCallback(
    (category: CompatibilityRelationshipCategory) => {
      if (category === relationshipCategory) return;
      request.current?.abort();
      const cached = cache.current[category];
      setState(cached ? { status: "success", data: cached } : { status: "loading" });
      changeCategoryQuery(category);
    },
    [changeCategoryQuery, relationshipCategory],
  );

  return {
    relationshipCategory,
    state,
    changeRelationshipCategory,
    reload: () => load(relationshipCategory, true),
  };
}
