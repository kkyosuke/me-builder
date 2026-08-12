import { useLiffSession } from "../../liff";
import { CompatibilityInvitationScreen } from "./compatibility-invitation-screen";
import { useCompatibilityInvitationAcceptance } from "./hooks/use-compatibility-invitation-acceptance";
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
  const acceptance = useCompatibilityInvitationAcceptance({ acquireIdToken, relationshipId });

  return (
    <CompatibilityInvitationScreen
      state={state}
      acceptanceState={acceptance.state}
      onAccept={() => void acceptance.accept()}
      onRetry={() => void reload()}
    />
  );
}
