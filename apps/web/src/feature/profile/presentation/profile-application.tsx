import { useState } from "react";
import { CompatibilityShareContentSection } from "../../compatibility";
import type { ProfileSummaryVersioning } from "../model/profile-summary";
import { GoalFollowUpSection } from "./goal-follow-up-section";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { SelfCareSection } from "./self-care-section";
import { useGoalFollowUps } from "./use-goal-follow-ups";
import { useProfileProgression } from "./use-profile-progression";
import { useProfileSummary } from "./use-profile-summary";
import { useSelfCareContexts } from "./use-self-care-contexts";
import { useWeeklyReflection } from "./use-weekly-reflection";
import { WeeklyReflectionSection } from "./weekly-reflection-section";

export default function ProfileApplication() {
  const summary = useProfileSummary();
  const progression = useProfileProgression();
  const weeklyReflection = useWeeklyReflection();
  const goalFollowUps = useGoalFollowUps();
  const selfCare = useSelfCareContexts();
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
      <GoalFollowUpSection
        state={goalFollowUps.state}
        pendingId={goalFollowUps.pendingId}
        operationError={goalFollowUps.operationError}
        onRetry={() => void goalFollowUps.reload()}
        onAgree={(brainItemId, nextStep) => void goalFollowUps.agree(brainItemId, nextStep)}
        onUpdate={(id, input) => void goalFollowUps.update(id, input)}
      />
      <SelfCareSection
        state={selfCare.state}
        pendingId={selfCare.pendingId}
        operationError={selfCare.operationError}
        onRetry={() => void selfCare.reload()}
        onRevoke={(id) => void selfCare.revoke(id)}
      />
      <CompatibilityShareContentSection latestProfileSummaryVersionId={latestVersionId} />
    </ProfileSummaryScreen>
  );
}
