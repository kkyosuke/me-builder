import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import { resolveRequestedLocation } from "../../../infrastructure/requested-pathname";
import { type AuthSessionResponse, fetchAuthSession } from "../infrastructure/auth-session-api";
import { authSessionRuntime } from "../infrastructure/auth-session-runtime";
import {
  detectAuthEntryEnvironment,
  establishLiffAuthSession,
} from "../infrastructure/liff-auth-adapter";
import {
  consumeSsoCallbackFailure,
  establishSsoAuthSession,
} from "../infrastructure/sso-auth-adapter";
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
  const [state, setState] = useState<AuthState>({ status: "checking" });
  const initializationRef = useRef<Promise<AuthState> | null>(null);
  const recheckControllerRef = useRef<AbortController | null>(null);
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
      profile: response.displayProfile ?? {},
      role: response.role,
      revision: revisionRef.current,
    };
  }, []);

  const establish = useCallback(
    async (signal: AbortSignal): Promise<AuthState> => {
      const returnTo = resolveRequestedLocation();
      const entry = await detectAuthEntryEnvironment(config.liffId);
      if (entry.kind === "error") {
        throw new Error(
          `${entry.message} SSOへ自動切替はしません。再試行するか外部ブラウザで開いてください。`,
        );
      }

      if (entry.kind === "external") {
        const existing = await fetchAuthSession(config.apiUrl, signal);
        if (existing.authenticated) return applyResponse(existing);
        if (config.ssoRolloutMode === "linked-login") {
          const callbackFailure = consumeSsoCallbackFailure();
          if (callbackFailure) {
            return {
              status: "error",
              reason: "credential-rejected",
              message:
                callbackFailure === "cancelled"
                  ? "SSO認証をキャンセルしました。必要な場合はもう一度お試しください。"
                  : "SSO認証を完了できませんでした。時間をおいてもう一度お試しください。",
            };
          }
          await establishSsoAuthSession(config.apiUrl, returnTo, signal);
          return { status: "redirecting" };
        }
      }

      const exchanged = await establishLiffAuthSession(
        config.apiUrl,
        config.liffId,
        signal,
        entry.state,
      );
      if ("redirecting" in exchanged) return { status: "redirecting" };
      const nextState = applyResponse(exchanged);
      if (exchanged.authenticated) authSessionRuntime.notifyExternalSessionChange();
      return nextState;
    },
    [applyResponse],
  );

  const refresh = useCallback(
    async (
      signal: AbortSignal,
      strategy: "establish" | "existing-session-only" = "establish",
    ): Promise<AuthState> => {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const pending =
        initializationRef.current ??
        (strategy === "existing-session-only"
          ? fetchAuthSession(config.apiUrl, signal).then(applyResponse)
          : establish(signal));
      initializationRef.current = pending;
      try {
        const nextState = await pending;
        if (!signal.aborted) setState(nextState);
        return nextState;
      } catch (error) {
        authSessionRuntime.setCsrfToken(null);
        const nextState = errorState(error);
        if (!signal.aborted) setState(nextState);
        return nextState;
      } finally {
        if (initializationRef.current === pending) initializationRef.current = null;
      }
    },
    [applyResponse, establish],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh(controller.signal);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refresh]);

  useEffect(() => {
    const uninstall = authSessionRuntime.installRecheck(async () => {
      const controller = new AbortController();
      recheckControllerRef.current = controller;
      try {
        await refresh(controller.signal);
      } finally {
        if (recheckControllerRef.current === controller) recheckControllerRef.current = null;
      }
    });
    return () => {
      uninstall();
      recheckControllerRef.current?.abort();
      recheckControllerRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    return authSessionRuntime.installExternalSessionChange(() => {
      // Cookieは同一originのタブ間ですでに共有されている。ここでLIFF交換まで再実行すると、
      // 各タブが交換完了を再通知し続けるため、現在のapplication session確認だけを行う。
      void refresh(new AbortController().signal, "existing-session-only");
    });
  }, [refresh]);

  const retry = useCallback(() => {
    setState({ status: "checking" });
    return refresh(new AbortController().signal);
  }, [refresh]);

  return { state, retry };
}
