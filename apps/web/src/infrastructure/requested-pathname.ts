/** LIFF deep linkのliff.stateを含め、利用者が要求したSPA pathnameを返す。 */
export function resolveRequestedPathname(): string {
  if (typeof window === "undefined") return "/diagnosis";

  const liffState = new URLSearchParams(window.location.search).get("liff.state");
  if (!liffState?.startsWith("/") || liffState === "/") return window.location.pathname;
  return liffState.split(/[?#]/, 1)[0] ?? window.location.pathname;
}
