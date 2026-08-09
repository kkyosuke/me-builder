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
  const [previewVersionId, setPreviewVersionId] = useState("preview-version-3");
  const [previewGenerationStatus, setPreviewGenerationStatus] = useState<"idle" | "generating">(
    "idle",
  );
  const currentSummary = summary.state.status === "success" ? summary.state.data.summary : null;
  const versioning: ProfileSummaryVersioning | undefined = currentSummary
    ? {
        versions: showDevelopmentBrainItems
          ? [
              {
                id: "preview-version-3",
                sequence: 3,
                generatedAt: currentSummary.generatedAt,
                isLatest: true,
                generationMethod: "ai",
              },
              {
                id: "preview-version-2",
                sequence: 2,
                generatedAt: "2026-08-01T12:00:00.000Z",
                isLatest: false,
                generationMethod: "ai",
              },
              {
                id: "preview-version-1",
                sequence: 1,
                generatedAt: "2026-07-24T12:00:00.000Z",
                isLatest: false,
                generationMethod: "ai",
              },
            ]
          : [
              {
                id: currentSummary.generatedAt,
                sequence: null,
                generatedAt: currentSummary.generatedAt,
                isLatest: true,
                generationMethod: "deterministic",
              },
            ],
        selectedVersionId: showDevelopmentBrainItems
          ? previewVersionId
          : currentSummary.generatedAt,
        generation: showDevelopmentBrainItems
          ? {
              status: previewGenerationStatus,
              canRegenerate: true,
              reasons: ["diagnosis", "brain", "elapsed"],
            }
          : { status: "idle", canRegenerate: false, reasons: [] },
      }
    : undefined;
  const brainItems = useDevelopmentBrainItems({
    enabled: showDevelopmentBrainItems,
    acquireIdToken: liffSession.acquireIdToken,
  });
  return (
    <ProfileSummaryScreen
      state={summary.state}
      {...(currentSummary
        ? {
            availableDataCounts: {
              diagnosis: currentSummary.diagnosisCount,
              diary: currentSummary.diaryCount,
            },
          }
        : {})}
      onRetry={() => void summary.reload()}
      {...(versioning ? { versioning } : {})}
      {...(showDevelopmentBrainItems ? { onSelectVersion: setPreviewVersionId } : {})}
      {...(showDevelopmentBrainItems
        ? { onRegenerate: () => setPreviewGenerationStatus("generating") }
        : {})}
    >
      {showDevelopmentBrainItems && (
        <DevelopmentBrainItems state={brainItems.state} onRetry={() => void brainItems.reload()} />
      )}
    </ProfileSummaryScreen>
  );
}
