import { Suspense, lazy, useEffect } from "react";
import { DocumentMetadata } from "./components/document-metadata";
import { LoadingState } from "./components/loading-state";
import { NotFoundScreen } from "./components/not-found-screen";
import { WebStartupSkeleton } from "./components/web-startup-skeleton";
import { resolveServiceSiteRoute } from "./feature/service-site";
import {
  hasLiffDeepLinkLocation,
  resolveRequestedPathname,
} from "./infrastructure/requested-pathname";
import { resolveWebApplicationRoute } from "./model/web-application-route";
import { preloadWebApplicationRoute } from "./routes";

const ServiceSiteApplication = lazy(() =>
  import("./feature/service-site").then((feature) => ({
    default: feature.ServiceSiteApplication,
  })),
);
const WebApplication = lazy(() =>
  import("./App").then((application) => ({ default: application.App })),
);

export function RootApplication() {
  const requestedPathname = resolveRequestedPathname();
  const hasLiffDeepLink = hasLiffDeepLinkLocation();
  const route = hasLiffDeepLink ? null : resolveServiceSiteRoute(requestedPathname);
  const webRoute = route ? null : resolveWebApplicationRoute(requestedPathname);

  useEffect(() => {
    if (webRoute && webRoute !== "not-found") preloadWebApplicationRoute(webRoute);
  }, [webRoute]);

  return (
    <>
      {!route && <DocumentMetadata title="かがみ" robots="noindex,nofollow" />}
      {webRoute === "not-found" ? (
        <NotFoundScreen />
      ) : (
        <Suspense
          fallback={
            webRoute ? (
              <WebStartupSkeleton route={webRoute} />
            ) : (
              <LoadingState message="画面を読み込んでいます..." />
            )
          }
        >
          {route ? <ServiceSiteApplication route={route} /> : <WebApplication />}
        </Suspense>
      )}
    </>
  );
}
