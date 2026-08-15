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

  const load = useCallback(
    async (expectProcessing = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (mounted.current) {
        setState((current) =>
          current.status === "success"
            ? {
                status: "success",
                data: expectProcessing ? { ...current.data, isProcessing: true } : current.data,
              }
            : { status: "loading" },
        );
      }
      try {
        const idToken = await acquireIdToken(controller.signal);
        if (controller.signal.aborted) return;
        if (!idToken) {
          if (mounted.current) {
            setState({
              status: "error",
              message: "本人確認情報を取得できませんでした。LINEから開き直してください。",
            });
          }
          return;
        }
        const result = await fetchProfileProgression(config.apiUrl, idToken, controller.signal);
        if (mounted.current && !controller.signal.aborted) {
          setState({ status: "success", data: result });
        }
      } catch (error) {
        if (mounted.current && !controller.signal.aborted) {
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "うつしレベルを取得できませんでした。",
          });
        }
      }
    },
    [acquireIdToken],
  );

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

  useEffect(() => {
    if (state.status !== "success" || !state.data.isProcessing) return;
    const timer = window.setTimeout(() => void load(), 1_000);
    return () => window.clearTimeout(timer);
  }, [load, state]);

  return {
    state,
    reload: (options?: { expectProcessing?: boolean }) => load(options?.expectProcessing ?? false),
  };
}
