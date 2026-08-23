import { Suspense, lazy } from "react";
import { DocumentMetadata } from "./components/document-metadata";
import { LoadingState } from "./components/loading-state";
import { resolveServiceSiteRoute } from "./feature/service-site/model/service-site-route";
import {
  hasLiffDeepLinkLocation,
  resolveRequestedPathname,
} from "./infrastructure/requested-pathname";

const ServiceSiteApplication = lazy(() =>
  import("./feature/service-site").then((feature) => ({
    default: feature.ServiceSiteApplication,
  })),
);
const WebApplication = lazy(() =>
  import("./App").then((application) => ({ default: application.App })),
);

export function RootApplication() {
  const route = hasLiffDeepLinkLocation()
    ? null
    : resolveServiceSiteRoute(resolveRequestedPathname());

  return (
    <>
      {!route && <DocumentMetadata title="かがみ" robots="noindex,nofollow" />}
      <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
        {route ? <ServiceSiteApplication route={route} /> : <WebApplication />}
      </Suspense>
    </>
  );
}
