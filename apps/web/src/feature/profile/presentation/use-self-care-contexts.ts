import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  fetchSelfCareContexts,
  revokeSelfCareContext,
} from "../infrastructure/self-care-context-api";
import type { SelfCareContextResult } from "../model/self-care-context";

export function useSelfCareContexts() {
  const [state, setState] = useState<AsyncState<SelfCareContextResult>>({ status: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mutationId = useRef<string | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    try {
      const data = await fetchSelfCareContexts(config.apiUrl, nextController.signal);
      if (!nextController.signal.aborted) setState({ status: "success", data });
    } catch (error) {
      if (!nextController.signal.aborted) {
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "セルフケア情報を取得できませんでした。",
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const run = useCallback(
    async (id: string, operation: () => Promise<unknown>, successMessage: string) => {
      if (mutationId.current !== null) return;
      mutationId.current = id;
      setPendingId(id);
      setOperationError(null);
      setOperationNotice(null);
      try {
        await operation();
        await load();
        setOperationNotice(successMessage);
      } catch (error) {
        setOperationError(
          error instanceof Error ? error.message : "セルフケア情報を更新できませんでした。",
        );
      } finally {
        mutationId.current = null;
        setPendingId(null);
      }
    },
    [load],
  );

  return {
    state,
    pendingId,
    operationError,
    operationNotice,
    reload: load,
    revoke: (id: string) =>
      run(
        id,
        () => revokeSelfCareContext(config.apiUrl, id),
        "セルフケア情報の確認を取り消しました。",
      ),
  };
}
