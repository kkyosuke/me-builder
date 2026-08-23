function resolveLiffDeepLinkLocation(): string | null {
  if (typeof window === "undefined") return null;
  const liffState = new URLSearchParams(window.location.search).get("liff.state");
  if (!liffState?.startsWith("/") || liffState.startsWith("//") || liffState === "/") {
    return null;
  }

  const requestedUrl = new URL(liffState, window.location.origin);
  if (requestedUrl.origin !== window.location.origin) {
    return null;
  }
  return `${requestedUrl.pathname}${requestedUrl.search}${requestedUrl.hash}`;
}

/** 現在のlocationが、SPA内の移動先を持つLIFF deep linkかを返す。 */
export function hasLiffDeepLinkLocation(): boolean {
  return resolveLiffDeepLinkLocation() !== null;
}

/** LIFF deep linkのliff.stateを含め、利用者が要求したSPA内locationを返す。 */
export function resolveRequestedLocation(): string {
  if (typeof window === "undefined") return "/diagnosis";
  return (
    resolveLiffDeepLinkLocation() ??
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

/** LIFF deep linkのliff.stateを含め、利用者が要求したSPA pathnameを返す。 */
export function resolveRequestedPathname(): string {
  if (typeof window === "undefined") return "/diagnosis";
  return new URL(resolveRequestedLocation(), window.location.origin).pathname;
}
