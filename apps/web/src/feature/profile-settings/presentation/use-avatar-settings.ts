import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import {
  type AvatarStateResult,
  cancelAvatarJob,
  deleteAvatar,
  fetchAvatarImage,
  fetchAvatarState,
  selectAvatar,
  startAvatarGeneration,
  uploadAvatarSource,
} from "../infrastructure/avatar-api";
import type { AvatarDisplayState, AvatarSelection, AvatarState } from "../model/avatar";

type LoadStatus = "loading" | "ready" | "error";

type CachedImage = {
  source: string;
  objectUrl: string;
};

const EMPTY_STATE: AvatarDisplayState = { currentAvatar: null, job: null };
const RUNNING_STATUSES = new Set(["checking", "accepted", "generating"]);

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useAvatarSettings({
  acquireIdToken,
  enabled,
  pollingEnabled,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  enabled: boolean;
  pollingEnabled: boolean;
}) {
  const [displayState, setDisplayState] = useState<AvatarDisplayState>(EMPTY_STATE);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryDelay, setRetryDelay] = useState<number | null>(null);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const rawState = useRef<AvatarState | null>(null);
  const imageCache = useRef(new Map<string, CachedImage>());

  const clearImages = useCallback(() => {
    for (const image of imageCache.current.values()) URL.revokeObjectURL(image.objectUrl);
    imageCache.current.clear();
  }, []);

  const applyState = useCallback(
    async (state: AvatarState, idToken: string, signal: AbortSignal) => {
      const images = [
        ...(state.currentAvatar ? [state.currentAvatar] : []),
        ...(state.job?.candidates ?? []),
      ];
      const uniqueImages = new Map(images.map((image) => [image.id, image]));
      const neededIds = new Set(uniqueImages.keys());
      const nextCache = new Map(imageCache.current);
      const created: CachedImage[] = [];

      try {
        const results = await Promise.allSettled(
          [...uniqueImages.values()].map(async (image) => {
            const cached = imageCache.current.get(image.id);
            if (cached?.source === image.imageUrl) return;
            const blob = await fetchAvatarImage(config.apiUrl, idToken, image.imageUrl, signal);
            const next = { source: image.imageUrl, objectUrl: URL.createObjectURL(blob) };
            created.push(next);
            nextCache.set(image.id, next);
          }),
        );
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure) throw failure.reason;
      } catch (error) {
        for (const image of created) URL.revokeObjectURL(image.objectUrl);
        throw error;
      }

      if (signal.aborted || !mounted.current) {
        for (const image of created) URL.revokeObjectURL(image.objectUrl);
        return;
      }
      for (const id of nextCache.keys()) {
        if (!neededIds.has(id)) {
          nextCache.delete(id);
        }
      }
      for (const [id, image] of imageCache.current) {
        if (nextCache.get(id)?.objectUrl !== image.objectUrl) URL.revokeObjectURL(image.objectUrl);
      }
      imageCache.current = nextCache;
      const displayImage = (image: { id: string } | null): AvatarSelection | null => {
        if (!image) return null;
        const cached = imageCache.current.get(image.id);
        return cached ? { id: image.id, src: cached.objectUrl } : null;
      };
      rawState.current = state;
      setDisplayState({
        currentAvatar: displayImage(state.currentAvatar),
        job: state.job
          ? {
              ...state.job,
              candidates: state.job.candidates.flatMap((candidate) => {
                const image = displayImage(candidate);
                return image ? [{ ...image, expiresAt: candidate.expiresAt }] : [];
              }),
            }
          : null,
      });
      setLoadStatus("ready");
      setErrorMessage(null);
    },
    [],
  );

  const resolveToken = useCallback(
    async (signal: AbortSignal): Promise<string> => {
      const idToken = await acquireIdToken(signal);
      if (!idToken) throw new Error("LINEから開いて本人確認を完了してください。");
      return idToken;
    },
    [acquireIdToken],
  );

  const runStateRequest = useCallback(
    async (
      operation: (idToken: string, signal: AbortSignal) => Promise<AvatarStateResult>,
      fallback: string,
      showLoading: boolean,
    ): Promise<boolean> => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (showLoading && mounted.current) setLoadStatus("loading");
      try {
        const idToken = await resolveToken(controller.signal);
        const result = await operation(idToken, controller.signal);
        await applyState(result.state, idToken, controller.signal);
        if (!controller.signal.aborted && mounted.current) {
          setRetryDelay(result.retryAfterMilliseconds);
        }
        return !controller.signal.aborted;
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) {
          setLoadStatus(rawState.current ? "ready" : "error");
          setErrorMessage(messageFrom(error, fallback));
        }
        return false;
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
    [applyState, resolveToken],
  );

  const refresh = useCallback(
    (showLoading = false) =>
      runStateRequest(
        (idToken, signal) => fetchAvatarState(config.apiUrl, idToken, signal),
        "アバターを取得できませんでした。",
        showLoading,
      ),
    [runStateRequest],
  );

  const runAction = useCallback(
    async (
      operation: (idToken: string, signal: AbortSignal) => Promise<AvatarStateResult>,
      fallback: string,
    ): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      try {
        return await runStateRequest(operation, fallback, false);
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [runStateRequest],
  );

  const upload = useCallback(
    (file: File) =>
      runAction(
        (idToken, signal) => uploadAvatarSource(config.apiUrl, idToken, file, signal),
        "画像をアップロードできませんでした。",
      ),
    [runAction],
  );

  const generate = useCallback(async (): Promise<boolean> => {
    const jobId = rawState.current?.job?.id;
    if (!jobId) {
      setErrorMessage("人物確認済みの画像を選び直してください。");
      return false;
    }
    return runAction(
      (idToken, signal) => startAvatarGeneration(config.apiUrl, idToken, jobId, signal),
      "アバター生成を開始できませんでした。",
    );
  }, [runAction]);

  const choose = useCallback(
    (candidateId: string) =>
      runAction(
        (idToken, signal) => selectAvatar(config.apiUrl, idToken, candidateId, signal),
        "アバターを設定できませんでした。",
      ),
    [runAction],
  );

  const cancel = useCallback(async (): Promise<boolean> => {
    const jobId = rawState.current?.job?.id;
    if (!jobId || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const idToken = await resolveToken(controller.signal);
      await cancelAvatarJob(config.apiUrl, idToken, jobId, controller.signal);
      if (controller.signal.aborted) return false;
      const result = await fetchAvatarState(config.apiUrl, idToken, controller.signal);
      await applyState(result.state, idToken, controller.signal);
      return !controller.signal.aborted;
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setErrorMessage(messageFrom(error, "処理を中止できませんでした。"));
      }
      return false;
    } finally {
      busyRef.current = false;
      if (request.current === controller) request.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [applyState, resolveToken]);

  const remove = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const idToken = await resolveToken(controller.signal);
      await deleteAvatar(config.apiUrl, idToken, controller.signal);
      if (controller.signal.aborted) return false;
      const next = rawState.current
        ? { ...rawState.current, currentAvatar: null }
        : { currentAvatar: null, job: null };
      await applyState(next, idToken, controller.signal);
      return !controller.signal.aborted;
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setErrorMessage(messageFrom(error, "アバターを削除できませんでした。"));
      }
      return false;
    } finally {
      busyRef.current = false;
      if (request.current === controller) request.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [applyState, resolveToken]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setLoadStatus("ready");
      return () => {
        mounted.current = false;
        clearImages();
      };
    }
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh(true);
    });
    return () => {
      active = false;
      mounted.current = false;
      busyRef.current = false;
      request.current?.abort();
      clearImages();
    };
  }, [clearImages, enabled, refresh]);

  useEffect(() => {
    if (
      !enabled ||
      !pollingEnabled ||
      retryDelay === null ||
      !displayState.job ||
      !RUNNING_STATUSES.has(displayState.job.status)
    ) {
      return;
    }
    let timer: number | undefined;
    const poll = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    const schedule = () => {
      if (document.visibilityState === "visible") timer = window.setTimeout(poll, retryDelay);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    schedule();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [displayState.job, enabled, pollingEnabled, refresh, retryDelay]);

  return {
    ...displayState,
    loadStatus,
    errorMessage,
    busy,
    refresh: () => refresh(true),
    upload,
    generate,
    choose,
    cancel,
    remove,
  };
}

export type AvatarSettingsController = ReturnType<typeof useAvatarSettings>;
