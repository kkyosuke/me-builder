import { useState } from "react";
import { useLiffSession } from "../../liff";
import { shareCompatibilityInvitationToLine } from "../infrastructure/compatibility-invitation-sharing";
import type { CompatibilityRelationshipListItem } from "../model/compatibility-relationship";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { useCompatibilityRelationships } from "./hooks/use-compatibility-relationships";

export default function CompatibilityListApplication() {
  const { acquireIdToken, profile } = useLiffSession();
  const relationships = useCompatibilityRelationships({ acquireIdToken });
  const [sharingMessage, setSharingMessage] = useState<string | null>(null);

  const resend = async (
    item: Extract<CompatibilityRelationshipListItem, { status: "pending" }>,
  ) => {
    try {
      const destination = await shareCompatibilityInvitationToLine(
        profile?.displayName ?? null,
        item.invitationUrl,
      );
      setSharingMessage(
        destination === "line"
          ? "LINEの共有先を開きました。"
          : "端末の共有先を開きました。LINEを選んで送信してください。",
      );
    } catch (error) {
      setSharingMessage(error instanceof Error ? error.message : "LINEで送信できませんでした。");
    }
  };

  return (
    <CompatibilityListScreen
      state={relationships.state}
      operation={relationships.operation}
      sharingMessage={sharingMessage}
      onRetry={() => void relationships.reload()}
      onCancel={(relationshipId) => void relationships.cancel(relationshipId)}
      onResend={(item) => void resend(item)}
    />
  );
}
