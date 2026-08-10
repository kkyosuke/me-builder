import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import { getLiffIdToken, initializeLiff } from "../../infrastructure/liff-client";

/** LIFFを1画面につき1回初期化し、API認証に使うIDトークンを取得する。 */
export function useLiffSessionState(eager = true) {
  const initializationRef = useRef<ReturnType<typeof initializeLiff> | null>(null);
  const [isInitializing, setIsInitializing] = useState(eager && config.liffId !== undefined);

  const initialize = useCallback(async () => {
    const initialization = initializationRef.current ?? initializeLiff(config.liffId);
    initializationRef.current = initialization;
    const liffState = await initialization;
    if (liffState.status !== "ready" && initializationRef.current === initialization) {
      initializationRef.current = null;
    }
    return liffState;
  }, []);

  useEffect(() => {
    if (!eager) return;
    let active = true;
    void initialize().then(
      () => {
        if (active) setIsInitializing(false);
      },
      () => {
        if (active) setIsInitializing(false);
      },
    );
    return () => {
      active = false;
    };
  }, [eager, initialize]);

  const acquireIdToken = useCallback(
    async (signal: AbortSignal): Promise<string | null> => {
      const liffState = await initialize();
      if (signal.aborted || liffState.status === "login-required") {
        return null;
      }
      if (liffState.status !== "ready") {
        throw new Error(
          liffState.status === "error" ? liffState.message : "LINEから診断画面を開いてください。",
        );
      }

      const idToken = getLiffIdToken();
      if (!idToken) {
        throw new Error("IDトークンを取得できませんでした。LINEから開き直してください。");
      }
      return idToken;
    },
    [initialize],
  );

  return { acquireIdToken, isInitializing };
}
