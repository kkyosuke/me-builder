import { config } from "../../../config";
import { DevelopmentBrainItems, useDevelopmentBrainItems } from "../../brain";
import { useLiffSession } from "../../liff";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileSummary } from "./use-profile-summary";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  const showDevelopmentBrainItems = DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "");
  const brainItems = useDevelopmentBrainItems({
    enabled: showDevelopmentBrainItems,
    acquireIdToken: liffSession.acquireIdToken,
  });
  return (
    <ProfileSummaryScreen state={summary.state} onRetry={() => void summary.reload()}>
      {showDevelopmentBrainItems && (
        <DevelopmentBrainItems state={brainItems.state} onRetry={() => void brainItems.reload()} />
      )}
    </ProfileSummaryScreen>
  );
}
