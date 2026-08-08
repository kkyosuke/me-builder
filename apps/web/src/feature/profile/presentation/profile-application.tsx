import { useLiffSession } from "../../liff";
import { ProfileSummaryScreen } from "./profile-summary-screen";
import { useProfileSummary } from "./use-profile-summary";

export default function ProfileApplication() {
  const liffSession = useLiffSession();
  const summary = useProfileSummary({ acquireIdToken: liffSession.acquireIdToken });
  return <ProfileSummaryScreen state={summary.state} onRetry={() => void summary.reload()} />;
}
