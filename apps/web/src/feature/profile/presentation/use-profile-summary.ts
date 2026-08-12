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

const PROFILE_SUMMARY_POLL_INTERVALS_MS = [
  ...Array.from({ length: 5 }, () => 2_000),
  ...Array.from({ length: 10 }, () => 5_000),
  ...Array.from({ length: 24 }, () => 10_000),
] as const;

export type ProfileSummaryGenerationNotice = Readonly<{
  kind: "error" | "delayed";
  message: string;
}>;

function waitForNextPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useProfileSummary({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<ProfileSummaryReadResult>>({ status: "loading" });
  const [generationNotice, setGenerationNotice] = useState<ProfileSummaryGenerationNotice | null>(
    null,
  );
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);
  const generationRequest = useRef<AbortController | null>(null);
  const generationInFlight = useRef(false);

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
          setGenerationNotice(null);
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
    if (generationInFlight.current) return;
    generationInFlight.current = true;
    const controller = new AbortController();
    generationRequest.current = controller;
    const previousState = state;
    let generationAccepted = false;
    setState((current) => {
      if (current.status !== "success") return current;
      return {
        status: "success",
        data: {
          ...current.data,
          generation: {
            ...current.data.generation,
            status: "queued",
            canRegenerate: false,
          },
        },
      };
    });
    setGenerationNotice(null);
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (!idToken || controller.signal.aborted) {
        if (mounted.current) setState(previousState);
        return;
      }
      const generation = await requestProfileSummaryGeneration(
        config.apiUrl,
        idToken,
        controller.signal,
      );
      generationAccepted = true;
      if (mounted.current && !controller.signal.aborted) {
        setState((current) =>
          current.status === "success"
            ? {
                status: "success",
                data: {
                  ...current.data,
                  generation: { ...current.data.generation, status: generation.status },
                },
              }
            : current,
        );
      }

      for (const delayMs of [0, ...PROFILE_SUMMARY_POLL_INTERVALS_MS]) {
        if (delayMs > 0) await waitForNextPoll(delayMs, controller.signal);
        if (controller.signal.aborted) return;
        const latest = await fetchProfileSummary(config.apiUrl, idToken, controller.signal);
        if (mounted.current && !controller.signal.aborted) {
          setState({ status: "success", data: latest });
        }
        if (latest.generation.status === "idle" || latest.generation.status === "failed") return;
      }

      if (mounted.current && !controller.signal.aborted) {
        setGenerationNotice({
          kind: "delayed",
          message:
            "確認に時間がかかっています。生成は続いている可能性があります。最新の状態を再読み込みしてください。",
        });
      }
    } catch (error) {
      if (error instanceof ProfileSummaryGenerationUnavailableError) {
        await load(false);
        return;
      }
      if (mounted.current && !controller.signal.aborted) {
        if (!generationAccepted) await load(false);
        setGenerationNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "まとめを生成できませんでした。",
        });
      }
    } finally {
      if (generationRequest.current === controller) {
        generationRequest.current = null;
        generationInFlight.current = false;
      }
    }
  }, [acquireIdToken, load, state]);

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
      generationInFlight.current = false;
      loading.current = false;
    };
  }, [load]);

  return { state, generationNotice, reload: load, generate };
}
