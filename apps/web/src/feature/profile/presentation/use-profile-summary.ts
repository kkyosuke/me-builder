import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { fetchProfileSummary } from "../infrastructure/profile-api";
import type { ProfileSummaryResult } from "../model/profile-summary";

export function useProfileSummary({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<ProfileSummaryResult>>({ status: "loading" });
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (!idToken || controller.signal.aborted) return;
      const result = await fetchProfileSummary(config.apiUrl, idToken, controller.signal);
      if (!controller.signal.aborted) setState({ status: "success", data: result });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "まとめを生成できませんでした。",
        });
      }
    }
  }, [acquireIdToken]);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);

  return { state, reload: load };
}
