import { useEffect, useState } from "react";
import {
  type CompatibilityRoute,
  resolveCompatibilityRoute,
} from "../../model/compatibility-route";

function currentRoute(): CompatibilityRoute {
  if (typeof window === "undefined") return "list";
  return resolveCompatibilityRoute(window.location.pathname);
}

export function useCompatibilityRoute(): CompatibilityRoute {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const handlePopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return route;
}
