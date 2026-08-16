type RecheckSession = (signal: AbortSignal) => Promise<void>;

let csrfToken: string | null = null;
let recheckSession: RecheckSession | null = null;
let inFlightRecheck: Promise<void> | null = null;

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
  async recheck(signal: AbortSignal): Promise<void> {
    if (!recheckSession || signal.aborted) return;
    const pending = inFlightRecheck ?? recheckSession(signal);
    inFlightRecheck = pending;
    try {
      await pending;
    } finally {
      if (inFlightRecheck === pending) inFlightRecheck = null;
    }
  },
  reset(): void {
    csrfToken = null;
    recheckSession = null;
    inFlightRecheck = null;
  },
};
