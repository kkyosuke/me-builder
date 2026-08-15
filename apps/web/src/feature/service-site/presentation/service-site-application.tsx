import type { ServiceSiteRoute } from "../model/service-site-route";
import { ServiceSiteLayout } from "./components/service-site-layout";
import { ServiceSiteHomeScreen } from "./service-site-home-screen";

export function ServiceSiteApplication({ route }: { route: ServiceSiteRoute }) {
  return <ServiceSiteLayout>{route === "home" && <ServiceSiteHomeScreen />}</ServiceSiteLayout>;
}
