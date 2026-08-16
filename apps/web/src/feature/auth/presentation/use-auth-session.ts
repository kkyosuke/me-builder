import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import { resolveRequestedPathname } from "../../../infrastructure/requested-pathname";
import { useLiffSession } from "../../liff";
import { type AuthSessionResponse, fetchAuthSession } from "../infrastructure/auth-session-api";
import { authSessionRuntime } from "../infrastructure/auth-session-runtime";
import { establishLiffAuthSession } from "../infrastructure/liff-auth-adapter";
import type { AuthState } from "../model/auth-state";

function errorState(error: unknown): AuthState {
  if (error instanceof DOMException && error.name === "AbortError") return { status: "checking" };
  return {
    status: "error",
    reason: "network",
    message:
      error instanceof Error
        ? error.message
        : "認証状態を確認できませんでした。もう一度お試しください。",
  };
}

/** application sessionの確立と再確認を1つの共有状態として管理する。 */
export function useAuthSessionState() {
  const liffSession = useLiffSession();
  const [state, setState] = useState<AuthState>({ status: "checking" });
  const initializationRef = useRef<Promise<AuthState> | null>(null);
  const revisionRef = useRef(0);

  const applyResponse = useCallback((response: AuthSessionResponse): AuthState => {
    if (!response.authenticated) {
      authSessionRuntime.setCsrfToken(null);
      return { status: "unauthenticated", ...(response.reason ? { reason: response.reason } : {}) };
    }
    authSessionRuntime.setCsrfToken(response.csrfToken);
    revisionRef.current += 1;
    return {
      status: "authenticated",
      profile: response.profile,
      role: response.role,
      revision: revisionRef.current,
    };
  }, []);

  const establish = useCallback(
    async (signal: AbortSignal): Promise<AuthState> => {
      const existing = await fetchAuthSession(config.apiUrl, signal);
      if (existing.authenticated) return applyResponse(existing);

      const exchanged = await establishLiffAuthSession(
        config.apiUrl,
        liffSession.acquireIdToken,
        resolveRequestedPathname(),
        signal,
      );
      if ("redirecting" in exchanged) return { status: "redirecting" };
      return applyResponse(exchanged);
    },
    [applyResponse, liffSession.acquireIdToken],
  );

  const refresh = useCallback(
    async (signal: AbortSignal): Promise<AuthState> => {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const pending = initializationRef.current ?? establish(signal);
      initializationRef.current = pending;
      try {
        const nextState = await pending;
        if (!signal.aborted) setState(nextState);
        return nextState;
      } catch (error) {
        const nextState = errorState(error);
        if (!signal.aborted) setState(nextState);
        return nextState;
      } finally {
        if (initializationRef.current === pending) initializationRef.current = null;
      }
    },
    [establish],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(
    () =>
      authSessionRuntime.installRecheck(async (signal) => {
        await refresh(signal);
      }),
    [refresh],
  );

  const retry = useCallback(() => {
    setState({ status: "checking" });
    return refresh(new AbortController().signal);
  }, [refresh]);

  return { state, retry };
}
