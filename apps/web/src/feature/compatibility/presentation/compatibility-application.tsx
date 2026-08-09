import { useState } from "react";
import { aoi, me } from "../infrastructure/compatibility-demo";
import { CompatibilityInvitationScreen } from "./compatibility-invitation-screen";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { CompatibilityResultScreen } from "./compatibility-result-screen";
import { CompatibilityShareScreen } from "./compatibility-share-screen";

function requestedPathname(): string {
  if (typeof window === "undefined") return "/compatibility";
  if (window.location.pathname.startsWith("/compatibility")) return window.location.pathname;
  const liffState = new URLSearchParams(window.location.search).get("liff.state");
  if (!liffState?.startsWith("/compatibility")) return window.location.pathname;
  return liffState.split(/[?#]/, 1)[0] ?? window.location.pathname;
}

export default function CompatibilityApplication() {
  const [pathname] = useState(requestedPathname);

  if (pathname.startsWith("/compatibility/invitations/")) {
    return <CompatibilityInvitationScreen inviter={aoi} recipient={me} />;
  }
  if (pathname === "/compatibility/share") {
    return <CompatibilityShareScreen person={me} />;
  }
  if (pathname.startsWith("/compatibility/demo")) {
    return <CompatibilityResultScreen me={me} partner={aoi} />;
  }
  return <CompatibilityListScreen />;
}
