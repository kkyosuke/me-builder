import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import {
  cancelCompatibilityInvitation,
  fetchCompatibilityRelationships,
} from "../../infrastructure/compatibility-api";
import type { CompatibilityRelationshipList } from "../../model/compatibility-relationship";
import { isCompatibilityResourceUnavailableError } from "../../model/compatibility-resource-error";
import { useRevalidateOnResume } from "./use-revalidate-on-resume";

type AcquireIdToken = (signal: AbortSignal) => Promise<string | null>;

export function useCompatibilityRelationships({
  acquireIdToken,
}: {
  acquireIdToken: AcquireIdToken;
}) {
  const [state, setState] = useState<AsyncState<CompatibilityRelationshipList>>({
    status: "loading",
  });
  const [operation, setOperation] = useState<AsyncState<string>>({ status: "idle" });
  const [cancellingRelationshipId, setCancellingRelationshipId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const operationRequest = useRef<AbortController | null>(null);
  const hasExistingData = useRef(false);

  const load = useCallback(
    async (preserveExisting: boolean) => {
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
        const data = await fetchCompatibilityRelationships(config.apiUrl, token, controller.signal);
        if (!controller.signal.aborted) {
          hasExistingData.current = true;
          setRefreshError(null);
          setState({ status: "success", data });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message =
            error instanceof Error ? error.message : "相性一覧を読み込めませんでした。";
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
    [acquireIdToken],
  );

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => {
    if (operationRequest.current) return Promise.resolve();
    return load(true);
  }, [load]);

  useRevalidateOnResume(refresh);

  useEffect(() => {
    void reload();
    return () => {
      request.current?.abort();
      operationRequest.current?.abort();
    };
  }, [reload]);

  const cancel = useCallback(
    async (relationshipId: string) => {
      if (operationRequest.current) return;
      request.current?.abort();
      request.current = null;
      setIsRefreshing(false);
      setRefreshError(null);
      const controller = new AbortController();
      operationRequest.current = controller;
      setCancellingRelationshipId(relationshipId);
      setOperation({ status: "loading" });
      try {
        const token = await acquireIdToken(controller.signal);
        if (!token) throw new Error("LINEから相性画面を開いてください。");
        await cancelCompatibilityInvitation(
          config.apiUrl,
          token,
          relationshipId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setState((current) =>
          current.status === "success"
            ? {
                status: "success",
                data: {
                  ...current.data,
                  items: current.data.items.filter(
                    (item) => item.relationshipId !== relationshipId,
                  ),
                },
              }
            : current,
        );
        setOperation({ status: "success", data: "招待を取り消しました。" });
      } catch (error) {
        if (!controller.signal.aborted) {
          setOperation({
            status: "error",
            message: error instanceof Error ? error.message : "招待を取り消せませんでした。",
          });
        }
      } finally {
        if (operationRequest.current === controller) {
          operationRequest.current = null;
          if (!controller.signal.aborted) setCancellingRelationshipId(null);
        }
      }
    },
    [acquireIdToken],
  );

  return {
    state,
    operation,
    cancellingRelationshipId,
    isRefreshing,
    refreshError,
    reload,
    refresh,
    cancel,
  };
}
