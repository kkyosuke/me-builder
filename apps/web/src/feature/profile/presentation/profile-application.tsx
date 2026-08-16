import { useState } from "react";
import { CompatibilityShareContentSection } from "../../compatibility";
import { useLiffSession } from "../../liff";
import type { ProfileSummaryVersioning } from "../model/profile-summary";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileProgression } from "./use-profile-progression";
import { useProfileSummary } from "./use-profile-summary";
import { useWeeklyReflection } from "./use-weekly-reflection";
import { WeeklyReflectionSection } from "./weekly-reflection-section";

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  const progression = useProfileProgression({ acquireIdToken: liffSession.acquireIdToken });
  const weeklyReflection = useWeeklyReflection({ acquireIdToken: liffSession.acquireIdToken });
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
      progression={progression.state}
      generationNotice={summary.generationNotice}
      {...(result ? { availableDataCounts: result.availableDataCounts } : {})}
      onRetry={() => {
        void summary.reload();
        void progression.reload();
      }}
      {...(versioning ? { versioning } : {})}
      {...(result && result.versions.length > 1 ? { onSelectVersion: setSelectedVersionId } : {})}
      {...(result ? { onRegenerate: () => void summary.generate() } : {})}
    >
      <WeeklyReflectionSection
        state={weeklyReflection.state}
        onGenerate={() => void weeklyReflection.generate()}
      />
      <CompatibilityShareContentSection
        acquireIdToken={liffSession.acquireIdToken}
        latestProfileSummaryVersionId={latestVersionId}
      />
    </ProfileSummaryScreen>
  );
}
