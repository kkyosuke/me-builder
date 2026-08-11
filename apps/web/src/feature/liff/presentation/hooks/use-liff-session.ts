import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import { getLiffIdToken, initializeLiff } from "../../infrastructure/liff-client";
import type { LiffDisplayProfile } from "../../model/types";

/** LIFFを初期化し、表示用プロフィールとAPI認証用IDトークンを共有する。 */
export function useLiffSessionState(eager = true) {
  const initializationRef = useRef<ReturnType<typeof initializeLiff> | null>(null);
  const [profile, setProfile] = useState<LiffDisplayProfile | null>(null);

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
      (liffState) => {
        if (active) setProfile(liffState.status === "ready" ? liffState.profile : null);
      },
      () => undefined,
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

  return { acquireIdToken, profile };
}
