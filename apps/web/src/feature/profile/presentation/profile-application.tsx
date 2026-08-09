import { useLiffSession } from "../../liff";
import type { ProfileSummaryVersioning } from "../model/profile-summary";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileSummary } from "./use-profile-summary";

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  const currentSummary = summary.state.status === "success" ? summary.state.data.summary : null;
  const versioning: ProfileSummaryVersioning | undefined = currentSummary
    ? {
        versions: [
          {
            id: currentSummary.generatedAt,
            sequence: null,
            generatedAt: currentSummary.generatedAt,
            isLatest: true,
            generationMethod: "deterministic",
          },
        ],
        selectedVersionId: currentSummary.generatedAt,
        generation: { status: "idle", canRegenerate: false, reasons: [] },
      }
    : undefined;

  return (
    <ProfileSummaryScreen
      state={summary.state}
      onRetry={() => void summary.reload()}
      {...(versioning ? { versioning } : {})}
    />
  );
}
