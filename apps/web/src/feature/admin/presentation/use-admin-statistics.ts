import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { fetchAdminStatistics } from "../infrastructure/admin-api";
import type { AdminStatistics } from "../model/statistics";

export function useAdminStatistics(
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>,
) {
  const [state, setState] = useState<AsyncState<AdminStatistics>>({ status: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const load = useCallback(
    async (signal: AbortSignal, showLoading: boolean) => {
      if (showLoading) setState({ status: "loading" });
      else setIsRefreshing(true);
      try {
        const token = await acquireIdToken(signal);
        if (signal.aborted) return;
        if (!token) {
          setState({ status: "error", message: "LINEから管理者画面を開いてください。" });
          return;
        }
        const statistics = await fetchAdminStatistics(config.apiUrl, token, signal);
        if (!signal.aborted) setState({ status: "success", data: statistics });
      } catch (error) {
        if (!signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "統計情報を取得できませんでした。",
          });
        }
      } finally {
        if (!signal.aborted) setIsRefreshing(false);
      }
    },
    [acquireIdToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    void load(controller.signal, true);
    return () => activeController.current?.abort();
  }, [load]);

  const reload = useCallback(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    return load(controller.signal, false);
  }, [load]);

  return { state, isRefreshing, reload };
}
