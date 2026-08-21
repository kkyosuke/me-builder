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

type AuthResolution =
  | { kind: "state"; state: AuthState }
  | {
      kind: "session";
      response: AuthSessionResponse;
      notifyExternalSessionChange: boolean;
    };

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
  const externalSyncControllerRef = useRef<AbortController | null>(null);
  const sessionChangeEpochRef = useRef(0);
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

  const establish = useCallback(async (signal: AbortSignal): Promise<AuthResolution> => {
    const returnTo = resolveRequestedLocation();
    const entry = await detectAuthEntryEnvironment(config.liffId);
    if (entry.kind === "error") {
      throw new Error(
        `${entry.message} Googleログインへ自動切替はしません。再試行するか外部ブラウザで開いてください。`,
      );
    }

    if (entry.kind === "external") {
      const existing = await fetchAuthSession(config.apiUrl, signal);
      if (existing.authenticated) {
        return {
          kind: "session",
          response: existing,
          notifyExternalSessionChange: false,
        };
      }
      if (config.ssoRolloutMode === "linked-login") {
        const callbackFailure = consumeSsoCallbackFailure();
        if (callbackFailure) {
          return {
            kind: "state",
            state: {
              status: "error",
              reason: "credential-rejected",
              message:
                callbackFailure === "cancelled"
                  ? "Googleログインをキャンセルしました。必要な場合はもう一度お試しください。"
                  : "Googleログインを完了できませんでした。時間をおいてもう一度お試しください。",
            },
          };
        }
        await establishSsoAuthSession(config.apiUrl, returnTo, signal);
        return { kind: "state", state: { status: "redirecting" } };
      }
    }

    const exchanged = await establishLiffAuthSession(
      config.apiUrl,
      config.liffId,
      signal,
      entry.state,
    );
    if ("redirecting" in exchanged) {
      return { kind: "state", state: { status: "redirecting" } };
    }
    return {
      kind: "session",
      response: exchanged,
      notifyExternalSessionChange: exchanged.authenticated,
    };
  }, []);

  const refresh = useCallback(
    async (
      signal: AbortSignal,
      strategy: "establish" | "existing-session-only" = "establish",
    ): Promise<AuthState> => {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      if (initializationRef.current) return await initializationRef.current;
      const requestEpoch = sessionChangeEpochRef.current;
      const resolution =
        strategy === "existing-session-only"
          ? fetchAuthSession(config.apiUrl, signal).then(
              (response): AuthResolution => ({
                kind: "session",
                response,
                notifyExternalSessionChange: false,
              }),
            )
          : establish(signal);
      const pending = (async (): Promise<AuthState> => {
        try {
          const resolved = await resolution;
          if (signal.aborted || requestEpoch !== sessionChangeEpochRef.current) {
            return { status: "checking" };
          }
          const nextState =
            resolved.kind === "session" ? applyResponse(resolved.response) : resolved.state;
          setState(nextState);
          if (resolved.kind === "session" && resolved.notifyExternalSessionChange) {
            authSessionRuntime.notifyExternalSessionChange();
          }
          return nextState;
        } catch (error) {
          if (signal.aborted || requestEpoch !== sessionChangeEpochRef.current) {
            return { status: "checking" };
          }
          authSessionRuntime.setCsrfToken(null);
          const nextState = errorState(error);
          setState(nextState);
          return nextState;
        }
      })();
      initializationRef.current = pending;
      try {
        return await pending;
      } finally {
        if (initializationRef.current === pending) initializationRef.current = null;
      }
    },
    [applyResponse, establish],
  );

  const synchronizeExistingSession = useCallback(async (): Promise<AuthState> => {
    externalSyncControllerRef.current?.abort();
    const controller = new AbortController();
    externalSyncControllerRef.current = controller;
    const epoch = sessionChangeEpochRef.current + 1;
    sessionChangeEpochRef.current = epoch;
    authSessionRuntime.setCsrfToken(null);
    setState({ status: "checking" });
    try {
      await initializationRef.current;
      if (controller.signal.aborted || epoch !== sessionChangeEpochRef.current) {
        return { status: "checking" };
      }
      return await refresh(controller.signal, "existing-session-only");
    } finally {
      if (externalSyncControllerRef.current === controller) {
        externalSyncControllerRef.current = null;
      }
    }
  }, [refresh]);

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
    const uninstall = authSessionRuntime.installRecheck(async (strategy) => {
      if (strategy === "existing-session-only") {
        await synchronizeExistingSession();
        return;
      }
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
  }, [refresh, synchronizeExistingSession]);

  useEffect(() => {
    const uninstall = authSessionRuntime.installExternalSessionChange(() => {
      // Cookieは同一originのタブ間ですでに共有されている。ここでLIFF交換まで再実行すると、
      // 各タブが交換完了を再通知し続けるため、現在のapplication session確認だけを行う。
      void synchronizeExistingSession();
    });
    return () => {
      uninstall();
      externalSyncControllerRef.current?.abort();
      externalSyncControllerRef.current = null;
    };
  }, [synchronizeExistingSession]);

  const retry = useCallback(() => {
    setState({ status: "checking" });
    return refresh(new AbortController().signal);
  }, [refresh]);

  return { state, retry };
}
