import { useCallback } from "react";
import { config } from "../../../../config";
import { getLiffIdToken, initializeLiff } from "../../infrastructure/liff-client";

/** LIFFを初期化し、API認証に使うIDトークンを取得する。 */
export function useLiffSession() {
  const acquireIdToken = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    const liffState = await initializeLiff(config.liffId);
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
