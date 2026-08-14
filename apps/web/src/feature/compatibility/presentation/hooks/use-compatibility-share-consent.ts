import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { fetchCompatibilityShareConsent } from "../../infrastructure/compatibility-api";
import { fetchCompatibilityAvatarImage } from "../../infrastructure/compatibility-avatar-api";
import type { CompatibilityShareConsent } from "../../model/compatibility-share-consent";

export function useCompatibilityShareConsent({
  acquireIdToken,
  relationshipCategory,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  relationshipCategory: CompatibilityRelationshipCategory | null;
}) {
  const [state, setState] = useState<AsyncState<CompatibilityShareConsent>>({
    status: "loading",
  });
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);
  const avatarObjectUrl = useRef<string | null>(null);
  const relationshipCategoryRef = useRef(relationshipCategory);
  const loadedGuidanceCategory = useRef<CompatibilityRelationshipCategory | null>(null);
  relationshipCategoryRef.current = relationshipCategory;

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) setState({ status: "loading" });
    try {
      const category = relationshipCategoryRef.current;
      const idToken = await acquireIdToken(controller.signal);
      if (controller.signal.aborted) return;
      if (!idToken) {
        throw new Error("LINEから相性共有画面を開いてください。");
      }
      const consent = await fetchCompatibilityShareConsent(
        config.apiUrl,
        idToken,
        category ?? undefined,
        controller.signal,
      );
      const avatarBlob = await fetchCompatibilityAvatarImage(
        config.apiUrl,
        idToken,
        consent.avatarUrl,
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) {
        const nextAvatarObjectUrl = avatarBlob ? URL.createObjectURL(avatarBlob) : null;
        if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
        avatarObjectUrl.current = nextAvatarObjectUrl;
        loadedGuidanceCategory.current = category;
        setState({
          status: "success",
          data: { ...consent, avatarUrl: nextAvatarObjectUrl },
        });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "共有の確認を読み込めませんでした。",
        });
      }
    } finally {
      if (request.current === controller) loading.current = false;
    }
  }, [acquireIdToken]);

  const refreshGuidance = useCallback(
    async (category: CompatibilityRelationshipCategory) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setState((current) =>
        current.status === "success"
          ? { status: "success", data: { ...current.data, nextAction: null } }
          : current,
      );
      try {
        const idToken = await acquireIdToken(controller.signal);
        if (controller.signal.aborted || !idToken) return;
        const consent = await fetchCompatibilityShareConsent(
          config.apiUrl,
          idToken,
          category,
          controller.signal,
        );
        if (mounted.current && !controller.signal.aborted) {
          loadedGuidanceCategory.current = category;
          setState((current) =>
            current.status === "success"
              ? {
                  status: "success",
                  data: { ...consent, avatarUrl: current.data.avatarUrl },
                }
              : current,
          );
        }
      } catch {
        // 案内の再取得に失敗しても、確認済みの共有可否とプロフィール表示は維持する。
      }
    },
    [acquireIdToken],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      mounted.current = false;
      request.current?.abort();
      if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
      avatarObjectUrl.current = null;
      loading.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (
      !relationshipCategory ||
      state.status !== "success" ||
      loadedGuidanceCategory.current === relationshipCategory
    ) {
      return;
    }
    void refreshGuidance(relationshipCategory);
  }, [relationshipCategory, refreshGuidance, state.status]);

  return { state, reload: load };
}
