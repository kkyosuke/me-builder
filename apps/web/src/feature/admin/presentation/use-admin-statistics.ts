import { useCallback, useEffect, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { fetchAdminStatistics } from "../infrastructure/admin-api";
import type { AdminStatistics } from "../model/statistics";

export function useAdminStatistics(
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>,
) {
  const [state, setState] = useState<AsyncState<AdminStatistics>>({ status: "loading" });
  const load = useCallback(
    async (signal: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const token = await acquireIdToken(signal);
        if (!token || signal.aborted) return;
        const statistics = await fetchAdminStatistics(config.apiUrl, token, signal);
        if (!signal.aborted) setState({ status: "success", data: statistics });
      } catch (error) {
        if (!signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "統計情報を取得できませんでした。",
          });
        }
      }
    },
    [acquireIdToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { state, reload: () => load(new AbortController().signal) };
}
