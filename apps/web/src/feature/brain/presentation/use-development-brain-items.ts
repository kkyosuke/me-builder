import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  fetchDevelopmentBrainItems,
  fetchDevelopmentBrainVector,
} from "../infrastructure/brain-api";
import type {
  DevelopmentBrainItemsResult,
  DevelopmentBrainVectorResult,
} from "../model/brain-item";

export function useDevelopmentBrainItems({
  enabled,
  acquireIdToken,
}: {
  enabled: boolean;
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<DevelopmentBrainItemsResult>>({
    status: "loading",
  });
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);
  const vectorRequests = useRef(new Map<string, AbortController>());
  const [vectorStates, setVectorStates] = useState<
    Record<string, AsyncState<DevelopmentBrainVectorResult>>
  >({});

  const load = useCallback(async () => {
    if (!enabled || loading.current) return;
    loading.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) setState({ status: "loading" });
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (!idToken || controller.signal.aborted) return;
      const result = await fetchDevelopmentBrainItems(config.apiUrl, idToken, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setState({ status: "success", data: result });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Brain Item一覧を取得できませんでした。",
        });
      }
    } finally {
      if (request.current === controller) loading.current = false;
    }
  }, [acquireIdToken, enabled]);

  const verifyVector = useCallback(
    async (brainItemId: string) => {
      if (!enabled) return;
      vectorRequests.current.get(brainItemId)?.abort();
      const controller = new AbortController();
      vectorRequests.current.set(brainItemId, controller);
      setVectorStates((current) => ({
        ...current,
        [brainItemId]: { status: "loading" },
      }));
      try {
        const idToken = await acquireIdToken(controller.signal);
        if (!idToken || controller.signal.aborted) return;
        const result = await fetchDevelopmentBrainVector(
          config.apiUrl,
          idToken,
          brainItemId,
          controller.signal,
        );
        if (mounted.current && !controller.signal.aborted) {
          setVectorStates((current) => ({
            ...current,
            [brainItemId]: { status: "success", data: result },
          }));
        }
      } catch (error) {
        if (mounted.current && !controller.signal.aborted) {
          setVectorStates((current) => ({
            ...current,
            [brainItemId]: {
              status: "error",
              message: error instanceof Error ? error.message : "Vectorを確認できませんでした。",
            },
          }));
        }
      } finally {
        if (vectorRequests.current.get(brainItemId) === controller) {
          vectorRequests.current.delete(brainItemId);
        }
      }
    },
    [acquireIdToken, enabled],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (enabled) {
      queueMicrotask(() => {
        if (active) void load();
      });
    }
    return () => {
      active = false;
      mounted.current = false;
      request.current?.abort();
      for (const controller of vectorRequests.current.values()) controller.abort();
      vectorRequests.current.clear();
      loading.current = false;
    };
  }, [enabled, load]);

  return { state, reload: load, vectorStates, verifyVector };
}
