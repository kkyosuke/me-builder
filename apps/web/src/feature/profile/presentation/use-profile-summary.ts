import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { fetchProfileSummary } from "../infrastructure/profile-api";
import type { ProfileSummaryReadResult } from "../model/profile-summary";

export function useProfileSummary({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<ProfileSummaryReadResult>>({ status: "loading" });
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) setState({ status: "loading" });
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (!idToken || controller.signal.aborted) return;
      const result = await fetchProfileSummary(config.apiUrl, idToken, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setState({ status: "success", data: result });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "まとめを生成できませんでした。",
        });
      }
    } finally {
      if (request.current === controller) loading.current = false;
    }
  }, [acquireIdToken]);

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
      loading.current = false;
    };
  }, [load]);

  return { state, reload: load };
}
