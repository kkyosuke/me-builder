/** LIFF deep linkのliff.stateを含め、利用者が要求したSPA内locationを返す。 */
export function resolveRequestedLocation(): string {
  if (typeof window === "undefined") return "/diagnosis";

  const liffState = new URLSearchParams(window.location.search).get("liff.state");
  if (!liffState?.startsWith("/") || liffState.startsWith("//") || liffState === "/") {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  const requestedUrl = new URL(liffState, window.location.origin);
  if (requestedUrl.origin !== window.location.origin) {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
  return `${requestedUrl.pathname}${requestedUrl.search}${requestedUrl.hash}`;
}

/** LIFF deep linkのliff.stateを含め、利用者が要求したSPA pathnameを返す。 */
export function resolveRequestedPathname(): string {
  if (typeof window === "undefined") return "/diagnosis";
  return new URL(resolveRequestedLocation(), window.location.origin).pathname;
}
