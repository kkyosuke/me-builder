import { useState } from "react";
import { config } from "../../../config";
import { shouldShowProgressionPreview } from "../../../model/progression-preview";
import { useLiffSession } from "../../liff";
import type { ProfileSummaryVersioning } from "../model/profile-summary";
import type { UtsushiProgression } from "../model/progression";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileSummary } from "./use-profile-summary";

function progressionPreview(): UtsushiProgression | undefined {
  if (!shouldShowProgressionPreview(config.environment, window.location.search)) {
    return undefined;
  }
  return {
    level: 12,
    growthValue: 613,
    currentLevelThreshold: 605,
    nextLevelThreshold: 720,
    collectedPieces: 58,
    activePieces: 48,
    categoryCount: 6,
  };
}

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const previewProgression = progressionPreview();
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
      {...(previewProgression
        ? {
            progression: { status: "success" as const, data: previewProgression },
            isProgressionPreview: true,
          }
        : {})}
      generationNotice={summary.generationNotice}
      {...(result ? { availableDataCounts: result.availableDataCounts } : {})}
      onRetry={() => void summary.reload()}
      {...(versioning ? { versioning } : {})}
      {...(result && result.versions.length > 1 ? { onSelectVersion: setSelectedVersionId } : {})}
      {...(result ? { onRegenerate: () => void summary.generate() } : {})}
    />
  );
}
