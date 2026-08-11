import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  fetchProfileSummary,
  requestProfileSummaryGeneration,
} from "../infrastructure/profile-api";
import {
  ProfileSummaryGenerationUnavailableError,
  type ProfileSummaryReadResult,
} from "../model/profile-summary";

export function useProfileSummary({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<ProfileSummaryReadResult>>({ status: "loading" });
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);
  const generationRequest = useRef<AbortController | null>(null);

  const load = useCallback(
    async (showLoading = true) => {
      if (loading.current) return;
      loading.current = true;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (mounted.current && showLoading) setState({ status: "loading" });
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
    },
    [acquireIdToken],
  );

  const generate = useCallback(async () => {
    generationRequest.current?.abort();
    const controller = new AbortController();
    generationRequest.current = controller;
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (!idToken || controller.signal.aborted) return;
      const accepted = await requestProfileSummaryGeneration(
        config.apiUrl,
        idToken,
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) {
        setState((current) =>
          current.status === "success"
            ? {
                status: "success",
                data: {
                  ...current.data,
                  generation: {
                    ...current.data.generation,
                    status: accepted.status,
                    canRegenerate: false,
                  },
                },
              }
            : current,
        );
      }
      for (let attempt = 0; attempt < 60 && !controller.signal.aborted; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        if (controller.signal.aborted) return;
        const latest = await fetchProfileSummary(config.apiUrl, idToken, controller.signal);
        if (mounted.current && !controller.signal.aborted) {
          setState({ status: "success", data: latest });
        }
        if (latest.generation.status === "idle" || latest.generation.status === "failed") return;
      }
    } catch (error) {
      if (error instanceof ProfileSummaryGenerationUnavailableError) {
        await load(false);
        return;
      }
      if (mounted.current && !controller.signal.aborted) {
        setState((current) =>
          current.status === "success"
            ? {
                status: "success",
                data: {
                  ...current.data,
                  generation: {
                    ...current.data.generation,
                    status: "failed",
                    canRegenerate: true,
                    message:
                      error instanceof Error ? error.message : "まとめを生成できませんでした。",
                  },
                },
              }
            : current,
        );
      }
    }
  }, [acquireIdToken, load]);

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
      generationRequest.current?.abort();
      loading.current = false;
    };
  }, [load]);

  return { state, reload: load, generate };
}
