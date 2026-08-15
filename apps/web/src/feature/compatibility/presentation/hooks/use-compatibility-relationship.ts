import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import {
  endCompatibilityRelationship,
  fetchCompatibilityRelationship,
} from "../../infrastructure/compatibility-api";
import type { CompatibilityRelationship } from "../../model/compatibility-relationship";
import { isCompatibilityResourceUnavailableError } from "../../model/compatibility-resource-error";
import { useRevalidateOnResume } from "./use-revalidate-on-resume";

export function useCompatibilityRelationship({
  acquireIdToken,
  relationshipId,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  relationshipId: string | null;
}) {
  const [state, setState] = useState<AsyncState<CompatibilityRelationship>>({ status: "loading" });
  const [ending, setEnding] = useState<AsyncState<null>>({ status: "idle" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const endRequest = useRef<AbortController | null>(null);
  const hasExistingData = useRef(false);

  const load = useCallback(
    async (preserveExisting: boolean) => {
      if (!relationshipId) {
        setState({ status: "error", message: "相性シートのURLが正しくありません。" });
        return;
      }
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (preserveExisting) {
        setIsRefreshing(true);
        setRefreshError(null);
      } else {
        hasExistingData.current = false;
        setIsRefreshing(false);
        setRefreshError(null);
        setState({ status: "loading" });
      }
      try {
        const token = await acquireIdToken(controller.signal);
        if (!token) throw new Error("LINEから相性画面を開いてください。");
        const data = await fetchCompatibilityRelationship(
          config.apiUrl,
          token,
          relationshipId,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          hasExistingData.current = true;
          setRefreshError(null);
          setState({ status: "success", data });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message =
            error instanceof Error ? error.message : "相性シートを読み込めませんでした。";
          if (
            preserveExisting &&
            hasExistingData.current &&
            !isCompatibilityResourceUnavailableError(error)
          ) {
            setRefreshError(message);
          } else {
            hasExistingData.current = false;
            setState({ status: "error", message });
          }
        }
      } finally {
        if (request.current === controller) {
          request.current = null;
          if (!controller.signal.aborted) setIsRefreshing(false);
        }
      }
    },
    [acquireIdToken, relationshipId],
  );

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => {
    if (endRequest.current) return Promise.resolve();
    return load(true);
  }, [load]);

  useRevalidateOnResume(refresh);

  useEffect(() => {
    void reload();
    return () => {
      request.current?.abort();
      endRequest.current?.abort();
    };
  }, [reload]);

  const end = useCallback(async () => {
    if (!relationshipId || endRequest.current) return;
    request.current?.abort();
    request.current = null;
    setIsRefreshing(false);
    setRefreshError(null);
    const controller = new AbortController();
    endRequest.current = controller;
    setEnding({ status: "loading" });
    try {
      const token = await acquireIdToken(controller.signal);
      if (controller.signal.aborted) return;
      if (!token) throw new Error("LINEから相性画面を開いてください。");
      await endCompatibilityRelationship(config.apiUrl, token, relationshipId, controller.signal);
      if (!controller.signal.aborted) setEnding({ status: "success", data: null });
    } catch (error) {
      if (!controller.signal.aborted) {
        setEnding({
          status: "error",
          message: error instanceof Error ? error.message : "共有を終了できませんでした。",
        });
      }
    } finally {
      if (endRequest.current === controller) endRequest.current = null;
    }
  }, [acquireIdToken, relationshipId]);

  return { state, ending, isRefreshing, refreshError, reload, refresh, end };
}
