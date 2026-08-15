import type { ServiceSiteRoute } from "../model/service-site-route";
import { ServiceSiteLayout } from "./components/service-site-layout";
import { ServiceSiteContactScreen } from "./service-site-contact-screen";
import { ServiceSiteHomeScreen } from "./service-site-home-screen";
import { ServiceSitePrivacyScreen } from "./service-site-privacy-screen";
import { ServiceSiteTermsScreen } from "./service-site-terms-screen";

export function ServiceSiteApplication({ route }: { route: ServiceSiteRoute }) {
  return (
    <ServiceSiteLayout>
      {route === "home" && <ServiceSiteHomeScreen />}
      {route === "terms" && <ServiceSiteTermsScreen />}
      {route === "privacy" && <ServiceSitePrivacyScreen />}
      {route === "contact" && <ServiceSiteContactScreen />}
    </ServiceSiteLayout>
  );
}
