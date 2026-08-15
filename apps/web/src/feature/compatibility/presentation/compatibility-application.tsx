import { Suspense, lazy } from "react";
import { LoadingState } from "../../../components/loading-state";
import {
  resolveCompatibilityInvitationId,
  resolveCompatibilityRelationshipId,
} from "../model/compatibility-route";
import {
  loadCompatibilityInvitationApplication,
  loadCompatibilityListApplication,
  loadCompatibilityResultApplication,
  loadCompatibilityShareApplication,
} from "./compatibility-route-loaders";
import { useCompatibilityRoute } from "./hooks/use-compatibility-route";

const CompatibilityInvitationApplication = lazy(loadCompatibilityInvitationApplication);
const CompatibilityListApplication = lazy(loadCompatibilityListApplication);
const CompatibilityResultApplication = lazy(loadCompatibilityResultApplication);
const CompatibilityShareApplication = lazy(loadCompatibilityShareApplication);

export default function CompatibilityApplication() {
  const { pathname, route } = useCompatibilityRoute();

  if (route === "list") {
    return (
      <Suspense fallback={<LoadingState message="相性一覧を読み込んでいます..." />}>
        <CompatibilityListApplication />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingState message="相性画面を読み込んでいます..." />}>
      {route === "invitation" ? (
        <CompatibilityInvitationApplication
          relationshipId={resolveCompatibilityInvitationId(pathname)}
        />
      ) : route === "share" ? (
        <CompatibilityShareApplication />
      ) : (
        <CompatibilityResultApplication
          relationshipId={resolveCompatibilityRelationshipId(pathname)}
        />
      )}
    </Suspense>
  );
}
