import { useState } from "react";
import { config } from "../../../config";
import { DevelopmentBrainItems, useDevelopmentBrainItems } from "../../brain";
import { useLiffSession } from "../../liff";
import type { ProfileSummaryVersioning } from "../model/profile-summary";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileSummary } from "./use-profile-summary";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  const showDevelopmentBrainItems = DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const result = summary.state.status === "success" ? summary.state.data : null;
  const selectedVersion = result
    ? (result.versions.find(({ id }) => id === selectedVersionId) ??
      result.versions.find(({ isLatest }) => isLatest) ??
      result.versions[0])
    : undefined;
  const screenState =
    summary.state.status === "success"
      ? {
          status: "success" as const,
          data: { ...summary.state.data, summary: selectedVersion?.summary ?? null },
        }
      : summary.state;
  const versioning: ProfileSummaryVersioning | undefined = selectedVersion
    ? {
        versions: result?.versions ?? [],
        selectedVersionId: selectedVersion.id,
        generation: result?.generation ?? {
          status: "idle",
          canRegenerate: false,
          reasons: [],
        },
      }
    : undefined;
  const brainItems = useDevelopmentBrainItems({
    enabled: showDevelopmentBrainItems,
    acquireIdToken: liffSession.acquireIdToken,
  });
  return (
    <ProfileSummaryScreen
      state={screenState}
      {...(result ? { availableDataCounts: result.availableDataCounts } : {})}
      onRetry={() => void summary.reload()}
      {...(versioning ? { versioning } : {})}
      {...(result && result.versions.length > 1 ? { onSelectVersion: setSelectedVersionId } : {})}
    >
      {showDevelopmentBrainItems && (
        <DevelopmentBrainItems state={brainItems.state} onRetry={() => void brainItems.reload()} />
      )}
    </ProfileSummaryScreen>
  );
}
