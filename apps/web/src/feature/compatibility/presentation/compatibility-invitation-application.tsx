import { useLiffSession } from "../../liff";
import { CompatibilityInvitationScreen } from "./compatibility-invitation-screen";
import { useCompatibilityInvitationPreview } from "./hooks/use-compatibility-invitation-preview";

export default function CompatibilityInvitationApplication({
  relationshipId,
}: {
  relationshipId: string | null;
}) {
  const { acquireIdToken } = useLiffSession();
  const { state, reload } = useCompatibilityInvitationPreview({
    acquireIdToken,
    relationshipId,
  });

  return <CompatibilityInvitationScreen state={state} onRetry={() => void reload()} />;
}
