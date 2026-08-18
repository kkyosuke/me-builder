import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  agreeGoalFollowUp,
  fetchGoalFollowUps,
  updateGoalFollowUp,
} from "../infrastructure/goal-follow-up-api";
import type { GoalFollowUpResult, GoalFollowUpStatus } from "../model/goal-follow-up";

export function useGoalFollowUps() {
  const [state, setState] = useState<AsyncState<GoalFollowUpResult>>({ status: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mutationId = useRef<string | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    try {
      const data = await fetchGoalFollowUps(config.apiUrl, nextController.signal);
      if (!nextController.signal.aborted) setState({ status: "success", data });
    } catch (error) {
      if (!nextController.signal.aborted) {
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "行動のフォローアップを取得できませんでした。",
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const run = useCallback(
    async (id: string, operation: () => Promise<unknown>) => {
      if (mutationId.current !== null) return;
      mutationId.current = id;
      setPendingId(id);
      setOperationError(null);
      try {
        await operation();
        await load();
      } catch (error) {
        setOperationError(
          error instanceof Error ? error.message : "行動のフォローアップを更新できませんでした。",
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
    reload: load,
    agree: (brainItemId: string, nextStep: string) =>
      run(brainItemId, () => agreeGoalFollowUp(config.apiUrl, { brainItemId, nextStep })),
    update: (id: string, input: Readonly<{ status?: GoalFollowUpStatus; nextStep?: string }>) =>
      run(id, () => updateGoalFollowUp(config.apiUrl, id, input)),
  };
}
