import { Suspense, lazy } from "react";
import { LoadingState } from "../../../components/loading-state";
import {
  aoi,
  compatibilityListData,
  demoInvitationUrl,
  me,
} from "../infrastructure/compatibility-demo";
import {
  copyCompatibilityInvitation,
  createLineShareUrl,
} from "../infrastructure/compatibility-share";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { useCompatibilityRoute } from "./hooks/use-compatibility-route";

const CompatibilityInvitationScreen = lazy(() =>
  import("./compatibility-invitation-screen").then((feature) => ({
    default: feature.CompatibilityInvitationScreen,
  })),
);
const CompatibilityResultScreen = lazy(() =>
  import("./compatibility-result-screen").then((feature) => ({
    default: feature.CompatibilityResultScreen,
  })),
);
const CompatibilityShareScreen = lazy(() =>
  import("./compatibility-share-screen").then((feature) => ({
    default: feature.CompatibilityShareScreen,
  })),
);

export default function CompatibilityApplication() {
  const route = useCompatibilityRoute();

  if (route === "list") {
    return <CompatibilityListScreen data={compatibilityListData} />;
  }

  return (
    <Suspense fallback={<LoadingState message="相性画面を読み込んでいます..." />}>
      {route === "invitation" ? (
        <CompatibilityInvitationScreen inviter={aoi} recipient={me} />
      ) : route === "share" ? (
        <CompatibilityShareScreen
          person={me}
          invitationUrl={demoInvitationUrl}
          lineShareUrl={createLineShareUrl(demoInvitationUrl)}
          copyInvitation={copyCompatibilityInvitation}
        />
      ) : (
        <CompatibilityResultScreen me={me} partner={aoi} />
      )}
    </Suspense>
  );
}
