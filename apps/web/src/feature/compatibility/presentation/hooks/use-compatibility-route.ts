import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { restoreWindowScroll } from "../../../../model/scroll-restoration";
import {
  type CompatibilityRoute,
  resolveCompatibilityPathname,
  resolveCompatibilityRoute,
} from "../../model/compatibility-route";

type CompatibilityRouting = Readonly<{ route: CompatibilityRoute; pathname: string }>;

function focusCompatibilityRouteHeading(route: CompatibilityRoute): () => void {
  let mutationObserver: MutationObserver | null = null;
  let timeoutId: number | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutationObserver?.disconnect();
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
  const focus = (): boolean => {
    const heading = document.querySelector<HTMLElement>(
      `[data-compatibility-route-heading="${route}"]`,
    );
    if (!heading) return false;
    heading.focus({ preventScroll: true });
    return true;
  };

  if (focus()) return stop;
  mutationObserver = new MutationObserver(() => {
    if (focus()) stop();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  timeoutId = window.setTimeout(stop, 5_000);

  return stop;
}

function currentRouting(): CompatibilityRouting {
  if (typeof window === "undefined") return { route: "list", pathname: "/compatibility" };
  const pathname = resolveCompatibilityPathname(window.location.pathname, window.location.search);
  return { route: resolveCompatibilityRoute(pathname), pathname };
}

function isCompatibilityPathname(pathname: string): boolean {
  return pathname === "/compatibility" || pathname.startsWith("/compatibility/");
}

export function useCompatibilityRoute(): CompatibilityRouting {
  const [routing, setRouting] = useState(currentRouting);
  const routingRef = useRef(routing);
  const scrollPositions = useRef(new Map<string, number>());
  const pendingScrollTop = useRef<number | null>(null);
  const pendingFocusRoute = useRef<CompatibilityRoute | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      const nextRouting = currentRouting();
      if (!isCompatibilityPathname(nextRouting.pathname)) return;
      const previousRouting = routingRef.current;
      if (nextRouting.pathname !== previousRouting.pathname) {
        scrollPositions.current.set(previousRouting.pathname, window.scrollY);
        pendingScrollTop.current = scrollPositions.current.get(nextRouting.pathname) ?? 0;
        pendingFocusRoute.current = nextRouting.route;
      }
      routingRef.current = nextRouting;
      setRouting(nextRouting);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useLayoutEffect(() => {
    const top = pendingScrollTop.current;
    const focusRoute = pendingFocusRoute.current;
    if (top === null && focusRoute === null) return;
    pendingScrollTop.current = null;
    pendingFocusRoute.current = null;
    const stopScrollRestoration = top === null ? () => undefined : restoreWindowScroll(top);
    const stopFocusRestoration = focusRoute
      ? focusCompatibilityRouteHeading(focusRoute)
      : () => undefined;
    return () => {
      stopScrollRestoration();
      stopFocusRestoration();
    };
  });

  return routing;
}
