import * as v from "valibot";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const SsoAuthorizationUrlSchema = v.object({
  flow: v.literal("same-browser"),
  authorizationUrl: v.pipe(v.string(), v.url()),
});

export function ssoLoginPath(returnTo: string): string {
  return `/api/auth/sso/login?${new URLSearchParams({ returnTo })}`;
}

/** callback失敗markerを一度だけ読み、再試行時のSSO再開を可能にする。 */
export function consumeSsoCallbackFailure(): "cancelled" | "error" | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const result = url.searchParams.get("sso");
  if (result !== "cancelled" && result !== "error") return undefined;
  url.searchParams.delete("sso");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return result;
}

export type SsoIdentityCallbackResult = "linked" | "cancelled" | "error";

/** application sessionが残るIdentity連携callbackの結果をURLから一度だけ消費する。 */
export function consumeSsoIdentityCallbackResult(): SsoIdentityCallbackResult | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const result = url.searchParams.get("sso");
  if (result !== "linked" && result !== "cancelled" && result !== "error") return undefined;
  url.searchParams.delete("sso");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return result;
}

/** provider tokenをWebへ戻さず、server-side SSO開始endpointへ遷移する。 */
export async function establishSsoAuthSession(
  apiUrl: string | undefined,
  returnTo: string,
  signal: AbortSignal,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<{ redirecting: true }> {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const response = await createAuthenticatedHttpClient(apiUrl, globalThis.fetch, {
    authentication: false,
  }).request(ssoLoginPath(returnTo), { method: "POST", signal });
  if (!response.ok) throw new Error("Googleログインを開始できませんでした。");
  const { authorizationUrl } = v.parse(SsoAuthorizationUrlSchema, await response.json());
  navigate(authorizationUrl);
  return { redirecting: true };
}
