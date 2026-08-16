export function ssoLoginUrl(apiUrl: string | undefined, returnTo: string): string {
  const baseUrl = (apiUrl ?? "").replace(/\/$/u, "");
  return `${baseUrl}/api/auth/sso/login?${new URLSearchParams({ returnTo })}`;
}

/** provider tokenをWebへ戻さず、server-side SSO開始endpointへ遷移する。 */
export function establishSsoAuthSession(
  apiUrl: string | undefined,
  returnTo: string,
  signal: AbortSignal,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): { redirecting: true } {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
  navigate(ssoLoginUrl(apiUrl, returnTo));
  return { redirecting: true };
}
