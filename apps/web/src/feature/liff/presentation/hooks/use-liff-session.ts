import { useCallback, useRef } from "react";
import { config } from "../../../../config";
import { getLiffIdToken, initializeLiff } from "../../infrastructure/liff-client";

/** LIFFを初期化し、API認証に使うIDトークンを取得する。 */
export function useLiffSession() {
  const initializationRef = useRef<ReturnType<typeof initializeLiff> | null>(null);

  const acquireIdToken = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    const initialization = initializationRef.current ?? initializeLiff(config.liffId);
    initializationRef.current = initialization;
    const liffState = await initialization;
    if (liffState.status !== "ready" && initializationRef.current === initialization) {
      initializationRef.current = null;
    }
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
  }, []);

  return { acquireIdToken };
}
