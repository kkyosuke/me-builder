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
        item.relationshipCategory,
        item.invitationUrl,
      );
      setSharingMessage(
        destination === "line"
          ? "LINEで招待を送信しました。"
          : destination === "system"
            ? "招待を共有しました。"
            : "送信をキャンセルしました。",
      );
    } catch (error) {
      setSharingMessage(error instanceof Error ? error.message : "LINEで送信できませんでした。");
    }
  };

  return (
    <CompatibilityListScreen
      state={relationships.state}
      operation={relationships.operation}
      cancellingRelationshipId={relationships.cancellingRelationshipId}
      sharingMessage={sharingMessage}
      onRetry={() => void relationships.reload()}
      onCancel={(relationshipId) => void relationships.cancel(relationshipId)}
      onResend={(item) => void resend(item)}
    />
  );
}
