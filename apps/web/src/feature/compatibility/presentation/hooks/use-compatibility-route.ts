import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { restoreWindowScroll } from "../../../../model/scroll-restoration";
import {
  type CompatibilityRoute,
  resolveCompatibilityPathname,
  resolveCompatibilityRoute,
} from "../../model/compatibility-route";

type CompatibilityRouting = Readonly<{ route: CompatibilityRoute; pathname: string }>;

function currentRouting(): CompatibilityRouting {
  if (typeof window === "undefined") return { route: "list", pathname: "/compatibility" };
  const pathname = resolveCompatibilityPathname(window.location.pathname, window.location.search);
  return { route: resolveCompatibilityRoute(pathname), pathname };
}

export function useCompatibilityRoute(): CompatibilityRouting {
  const [routing, setRouting] = useState(currentRouting);
  const routingRef = useRef(routing);
  const scrollPositions = useRef(new Map<string, number>());
  const pendingScrollTop = useRef<number | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      const nextRouting = currentRouting();
      const previousRouting = routingRef.current;
      if (nextRouting.pathname !== previousRouting.pathname) {
        scrollPositions.current.set(previousRouting.pathname, window.scrollY);
        pendingScrollTop.current = scrollPositions.current.get(nextRouting.pathname) ?? 0;
      }
      routingRef.current = nextRouting;
      setRouting(nextRouting);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useLayoutEffect(() => {
    const top = pendingScrollTop.current;
    if (top === null) return;
    pendingScrollTop.current = null;
    return restoreWindowScroll(top);
  });

  return routing;
}
