import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { fetchProfileProgression } from "../infrastructure/progression-api";
import type { UtsushiProgression } from "../model/progression";

export function useProfileProgression({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<UtsushiProgression>>({ status: "loading" });
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) setState({ status: "loading" });
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (!idToken || controller.signal.aborted) return;
      const result = await fetchProfileProgression(config.apiUrl, idToken, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setState({ status: "success", data: result });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "うつしレベルを取得できませんでした。",
        });
      }
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
    };
  }, [load]);

  return { state, reload: load };
}
