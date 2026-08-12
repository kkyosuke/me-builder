import { Suspense, lazy } from "react";
import { LoadingState } from "../../../components/loading-state";
import { aoi, compatibilityListData, me } from "../infrastructure/compatibility-demo";
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
const CompatibilityShareApplication = lazy(() => import("./compatibility-share-application"));

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
        <CompatibilityShareApplication />
      ) : (
        <CompatibilityResultScreen me={me} partner={aoi} />
      )}
    </Suspense>
  );
}
