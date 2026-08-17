import type { AuthSessionResponse } from "./auth-session-api";
import { exchangeLiffCredential } from "./auth-session-api";

type AcquireLiffCredential = (signal: AbortSignal) => Promise<string | null>;

/** 既存LIFF初期化を、provider tokenをfeatureへ公開しないsession交換境界へ適合させる。 */
export async function establishLiffAuthSession(
  apiUrl: string | undefined,
  acquireCredential: AcquireLiffCredential,
  signal: AbortSignal,
): Promise<AuthSessionResponse | { redirecting: true }> {
  const credential = await acquireCredential(signal);
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
  if (!credential) return { redirecting: true };
  return exchangeLiffCredential(apiUrl, credential, signal);
}
