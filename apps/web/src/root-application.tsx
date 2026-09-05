import { Suspense, lazy } from "react";
import { DocumentMetadata } from "./components/document-metadata";
import { LoadingState } from "./components/loading-state";
import { NotFoundScreen } from "./components/not-found-screen";
import { config } from "./config";
import { shouldShowDiagnosisCardPreview } from "./feature/diagnosis/model/diagnosis-card-preview";
import { resolveServiceSiteRoute } from "./feature/service-site";
import {
  hasLiffDeepLinkLocation,
  resolveRequestedPathname,
} from "./infrastructure/requested-pathname";
import { resolveWebApplicationRoute } from "./model/web-application-route";
import { loadDiagnosisCardPreview } from "./routes";

const ServiceSiteApplication = lazy(() =>
  import("./feature/service-site").then((feature) => ({
    default: feature.ServiceSiteApplication,
  })),
);
const WebApplication = lazy(() =>
  import("./App").then((application) => ({ default: application.App })),
);
const DiagnosisCardPreview = lazy(loadDiagnosisCardPreview);

export function RootApplication() {
  const requestedPathname = resolveRequestedPathname();
  const showDiagnosisCardPreview = shouldShowDiagnosisCardPreview(
    config.environment,
    requestedPathname,
  );
  if (showDiagnosisCardPreview) {
    return (
      <>
        <DocumentMetadata title="表裏カード開発用プレビュー | かがみ" robots="noindex,nofollow" />
        <Suspense fallback={<LoadingState message="ダミー診断を読み込んでいます..." />}>
          <DiagnosisCardPreview />
        </Suspense>
      </>
    );
  }

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
