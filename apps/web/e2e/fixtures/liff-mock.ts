type LiffE2eConfig = {
  initializationDelayMilliseconds?: number;
};

type LiffE2eState = {
  initCalls: number;
  initStartedPathnames: string[];
  initialized: boolean;
  loginCalls: number;
  restoredPathname: string | null;
  urlChangedBeforeRestore: boolean;
};

declare global {
  interface Window {
    __LIFF_E2E_CONFIG__?: LiffE2eConfig;
    __LIFF_E2E_STATE__?: LiffE2eState;
  }
}

function state(): LiffE2eState {
  const currentState = window.__LIFF_E2E_STATE__;
  if (currentState) return currentState;
  const initialState: LiffE2eState = {
    initCalls: 0,
    initStartedPathnames: [],
    initialized: false,
    loginCalls: 0,
    restoredPathname: null,
    urlChangedBeforeRestore: false,
  };
  window.__LIFF_E2E_STATE__ = initialState;
  return initialState;
}

const liff = {
  async init({ liffId }: { liffId: string }): Promise<void> {
    if (!liffId) throw new Error("liffId is required");
    const currentState = state();
    const initialUrl = window.location.href;
    currentState.initCalls += 1;
    currentState.initStartedPathnames.push(window.location.pathname);

    await new Promise((resolve) =>
      window.setTimeout(
        resolve,
        window.__LIFF_E2E_CONFIG__?.initializationDelayMilliseconds ?? 500,
      ),
    );

    if (window.location.href !== initialUrl) {
      currentState.urlChangedBeforeRestore = true;
    }

    const requestedUrl = new URL(initialUrl).searchParams.get("liff.state");
    if (requestedUrl?.startsWith("/")) {
      window.history.replaceState({}, "", requestedUrl);
      currentState.restoredPathname = window.location.pathname;
    }
    currentState.initialized = true;
  },
  getIDToken(): string {
    if (!state().initialized) throw new Error("LIFF is not initialized");
    return "e2e.id.token";
  },
  async getProfile(): Promise<{ displayName: string }> {
    if (!state().initialized) throw new Error("LIFF is not initialized");
    return { displayName: "E2Eユーザー" };
  },
  isInClient(): boolean {
    return true;
  },
  isLoggedIn(): boolean {
    return true;
  },
  login(): void {
    state().loginCalls += 1;
  },
};

export default liff;
