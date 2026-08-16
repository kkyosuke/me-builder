import {
  type LiffAuthExchangeInitialization,
  initializeLiffForAuthExchange,
  readLiffAuthExchangeCredential,
  redirectToLiffLogin,
} from "../../liff/infrastructure/liff-client";
import type { AuthSessionResponse } from "./auth-session-api";
import { exchangeLiffCredential } from "./auth-session-api";

let pendingInitialization: ReturnType<typeof initializeLiffForAuthExchange> | null = null;

async function initializeForAuthExchange(liffId: string | undefined) {
  const pending = pendingInitialization ?? initializeLiffForAuthExchange(liffId);
  pendingInitialization = pending;
  try {
    return await pending;
  } finally {
    if (pendingInitialization === pending) pendingInitialization = null;
  }
}

export async function detectAuthEntryEnvironment(
  liffId: string | undefined,
): Promise<
  | { kind: "liff"; state: LiffAuthExchangeInitialization }
  | { kind: "external"; state: LiffAuthExchangeInitialization }
  | { kind: "error"; message: string }
> {
  const state = await initializeForAuthExchange(liffId);
  if (state.status === "error") return { kind: "error", message: state.message };
  if ((state.status === "ready" || state.status === "login-required") && state.inClient) {
    return { kind: "liff", state };
  }
  return { kind: "external", state };
}

/** LIFF credentialをこの境界内だけで読み、application sessionへ交換する。 */
export async function establishLiffAuthSession(
  apiUrl: string | undefined,
  liffId: string | undefined,
  signal: AbortSignal,
  initializedState?: LiffAuthExchangeInitialization,
): Promise<AuthSessionResponse | { redirecting: true }> {
  const liffState = initializedState ?? (await initializeForAuthExchange(liffId));
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
  if (liffState.status === "login-required") {
    redirectToLiffLogin();
    return { redirecting: true };
  }
  if (liffState.status !== "ready") {
    throw new Error(
      liffState.status === "error"
        ? liffState.message
        : "LINEからアプリを開いて本人確認を完了してください。",
    );
  }
  const credential = readLiffAuthExchangeCredential();
  if (!credential) {
    throw new Error("本人確認情報を取得できませんでした。LINEから開き直してください。");
  }
  return exchangeLiffCredential(apiUrl, credential, signal);
}
