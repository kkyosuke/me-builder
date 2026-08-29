type RecheckStrategy = "establish" | "existing-session-only";
type RecheckSession = (strategy: RecheckStrategy) => Promise<void>;

let csrfToken: string | null = null;
let recheckSession: RecheckSession | null = null;
let inFlightRecheck: Promise<void> | null = null;
export const AUTH_SESSION_CHANGE_STORAGE_KEY = "me-builder-auth-session-change";

function waitForRecheck(pending: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** HttpOnly cookieと対になる、JavaScriptから参照可能なCSRF tokenだけをメモリに保持する。 */
export const authSessionRuntime = {
  csrfToken(): string | null {
    return csrfToken;
  },
  setCsrfToken(nextToken: string | null): void {
    csrfToken = nextToken;
  },
  installRecheck(recheck: RecheckSession): () => void {
    recheckSession = recheck;
    return () => {
      if (recheckSession === recheck) recheckSession = null;
    };
  },
  installExternalSessionChange(onChange: () => void): () => void {
    if (typeof window === "undefined") return () => undefined;
    const listener = (event: StorageEvent) => {
      if (event.key === AUTH_SESSION_CHANGE_STORAGE_KEY) onChange();
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  },
  /** Account識別子を保存せず、cookieが切り替わった事実だけを他タブへ通知する。 */
  notifyExternalSessionChange(): void {
    if (typeof window === "undefined") return;
    try {
      const nonce =
        typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36);
      window.localStorage.setItem(AUTH_SESSION_CHANGE_STORAGE_KEY, `${Date.now()}:${nonce}`);
    } catch {
      // Storageが利用できないWebViewでも、交換した現在タブのsession確立は継続する。
    }
  },
  /** session失効操作後に他タブへ通知し、現在タブはproviderへ遷移せずcookieだけを再確認する。 */
  async synchronizeAfterSessionChange(): Promise<void> {
    csrfToken = null;
    authSessionRuntime.notifyExternalSessionChange();
    await recheckSession?.("existing-session-only");
  },
  async recheck(signal: AbortSignal): Promise<void> {
    if (!recheckSession || signal.aborted) return;
    if (!inFlightRecheck) {
      const pending = recheckSession("establish");
      inFlightRecheck = pending;
      void pending.then(
        () => {
          if (inFlightRecheck === pending) inFlightRecheck = null;
        },
        () => {
          if (inFlightRecheck === pending) inFlightRecheck = null;
        },
      );
    }
    await waitForRecheck(inFlightRecheck, signal);
  },
  reset(): void {
    csrfToken = null;
    recheckSession = null;
    inFlightRecheck = null;
  },
};
