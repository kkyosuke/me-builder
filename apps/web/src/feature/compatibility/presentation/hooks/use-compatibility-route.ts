import { useEffect, useState } from "react";
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

  useEffect(() => {
    const handlePopState = () => setRouting(currentRouting());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return routing;
}
