import { useState } from "react";
import { CompatibilityShareContentSection } from "../../compatibility";
import { useLiffSession } from "../../liff";
import type { ProfileSummaryVersioning } from "../model/profile-summary";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileSummary } from "./use-profile-summary";

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const result = summary.state.status === "success" ? summary.state.data : null;
  const selectedVersion = result
    ? (result.versions.find(({ id }) => id === selectedVersionId) ??
      result.versions.find(({ isLatest }) => isLatest) ??
      result.versions[0])
    : undefined;
  const latestVersionId = result
    ? (result.versions.find(({ isLatest }) => isLatest)?.id ?? result.versions[0]?.id ?? null)
    : undefined;
  const screenState =
    summary.state.status === "success"
      ? {
          status: "success" as const,
          data: { ...summary.state.data, summary: selectedVersion?.summary ?? null },
        }
      : summary.state;
  const versioning: ProfileSummaryVersioning | undefined = result
    ? {
        versions: result.versions,
        selectedVersionId: selectedVersion?.id ?? null,
        generation: result.generation,
      }
    : undefined;
  return (
    <ProfileSummaryScreen
      state={screenState}
      generationNotice={summary.generationNotice}
      {...(result ? { availableDataCounts: result.availableDataCounts } : {})}
      onRetry={() => void summary.reload()}
      {...(versioning ? { versioning } : {})}
      {...(result && result.versions.length > 1 ? { onSelectVersion: setSelectedVersionId } : {})}
      {...(result ? { onRegenerate: () => void summary.generate() } : {})}
    >
      <CompatibilityShareContentSection
        acquireIdToken={liffSession.acquireIdToken}
        latestProfileSummaryVersionId={latestVersionId}
      />
    </ProfileSummaryScreen>
  );
}
