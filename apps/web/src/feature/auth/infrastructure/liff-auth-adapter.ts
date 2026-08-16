import {
  initializeLiffForAuthExchange,
  readLiffAuthExchangeCredential,
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

/** LIFF credentialをこの境界内だけで読み、application sessionへ交換する。 */
export async function establishLiffAuthSession(
  apiUrl: string | undefined,
  liffId: string | undefined,
  signal: AbortSignal,
): Promise<AuthSessionResponse | { redirecting: true }> {
  const liffState = await initializeForAuthExchange(liffId);
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
  if (liffState.status === "login-required") return { redirecting: true };
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
