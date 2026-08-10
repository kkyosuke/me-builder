import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import {
  deleteAvatar,
  fetchAvatarImage,
  fetchAvatarState,
  saveAvatar,
} from "../infrastructure/avatar-api";
import type { AvatarSelection, AvatarState } from "../model/avatar";

type LoadStatus = "loading" | "ready" | "error";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useAvatarSettings({
  acquireIdToken,
  enabled,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  enabled: boolean;
}) {
  const [currentAvatar, setCurrentAvatar] = useState<AvatarSelection | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);

  const replaceObjectUrl = useCallback((next: string | null) => {
    if (objectUrl.current && objectUrl.current !== next) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = next;
  }, []);

  const resolveToken = useCallback(
    async (signal: AbortSignal): Promise<string> => {
      const idToken = await acquireIdToken(signal);
      if (!idToken) throw new Error("LINEから開いて本人確認を完了してください。");
      return idToken;
    },
    [acquireIdToken],
  );

  const applyState = useCallback(
    async (state: AvatarState, idToken: string, signal: AbortSignal) => {
      if (!state.currentAvatar) {
        replaceObjectUrl(null);
        if (mounted.current && !signal.aborted) setCurrentAvatar(null);
        return;
      }
      const blob = await fetchAvatarImage(
        config.apiUrl,
        idToken,
        state.currentAvatar.imageUrl,
        signal,
      );
      const nextUrl = URL.createObjectURL(blob);
      if (signal.aborted || !mounted.current) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      replaceObjectUrl(nextUrl);
      setCurrentAvatar({ id: state.currentAvatar.id, src: nextUrl, source: "saved" });
    },
    [replaceObjectUrl],
  );

  const refresh = useCallback(
    async (showLoading = false): Promise<boolean> => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (showLoading && mounted.current) setLoadStatus("loading");
      try {
        const idToken = await resolveToken(controller.signal);
        const state = await fetchAvatarState(config.apiUrl, idToken, controller.signal);
        await applyState(state, idToken, controller.signal);
        if (!controller.signal.aborted && mounted.current) {
          setLoadStatus("ready");
          setErrorMessage(null);
        }
        return !controller.signal.aborted;
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) {
          setLoadStatus("error");
          setErrorMessage(messageFrom(error, "アバターを取得できませんでした。"));
        }
        return false;
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
    [applyState, resolveToken],
  );

  const save = useCallback(
    async (file: File): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const idToken = await resolveToken(controller.signal);
        const state = await saveAvatar(config.apiUrl, idToken, file, controller.signal);
        await applyState(state, idToken, controller.signal);
        return !controller.signal.aborted;
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) {
          setErrorMessage(messageFrom(error, "アバターを保存できませんでした。"));
        }
        return false;
      } finally {
        busyRef.current = false;
        if (request.current === controller) request.current = null;
        if (mounted.current) setBusy(false);
      }
    },
    [applyState, resolveToken],
  );

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
      replaceObjectUrl(null);
      setCurrentAvatar(null);
      return true;
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
  }, [replaceObjectUrl, resolveToken]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setLoadStatus("ready");
      return () => {
        mounted.current = false;
        replaceObjectUrl(null);
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
      replaceObjectUrl(null);
    };
  }, [enabled, refresh, replaceObjectUrl]);

  return {
    currentAvatar,
    loadStatus,
    errorMessage,
    busy,
    refresh: () => refresh(true),
    save,
    remove,
  };
}

export type AvatarSettingsController = ReturnType<typeof useAvatarSettings>;
