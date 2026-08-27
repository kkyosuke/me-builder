import { Suspense, lazy } from "react";
import { DocumentMetadata } from "./components/document-metadata";
import { LoadingState } from "./components/loading-state";
import { NotFoundScreen } from "./components/not-found-screen";
import { resolveServiceSiteRoute } from "./feature/service-site/model/service-site-route";
import {
  hasLiffDeepLinkLocation,
  resolveRequestedPathname,
} from "./infrastructure/requested-pathname";
import { resolveWebApplicationRoute } from "./model/web-application-route";

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
  const webRoute = route
    ? null
    : hasLiffDeepLink
      ? "diagnosis"
      : resolveWebApplicationRoute(requestedPathname);

  return (
    <>
      {!route && <DocumentMetadata title="かがみ" robots="noindex,nofollow" />}
      {webRoute === "not-found" ? (
        <NotFoundScreen />
      ) : (
        <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
          {route ? <ServiceSiteApplication route={route} /> : <WebApplication />}
        </Suspense>
      )}
    </>
  );
}
