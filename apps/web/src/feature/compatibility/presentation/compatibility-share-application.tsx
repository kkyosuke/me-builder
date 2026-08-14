import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { useRef, useState } from "react";
import { useLiffSession } from "../../liff";
import {
  copyCompatibilityInvitationUrl,
  shareCompatibilityInvitationToLine,
} from "../infrastructure/compatibility-invitation-sharing";
import { CompatibilityShareScreen } from "./compatibility-share-screen";
import { useCompatibilityInvitationIssue } from "./hooks/use-compatibility-invitation-issue";
import { useCompatibilityShareConsent } from "./hooks/use-compatibility-share-consent";

export default function CompatibilityShareApplication() {
  const { acquireIdToken } = useLiffSession();
  const [relationshipCategory, setRelationshipCategory] =
    useState<CompatibilityRelationshipCategory>("partner");
  const { state, reload } = useCompatibilityShareConsent({
    acquireIdToken,
    relationshipCategory,
  });
  const invitation = useCompatibilityInvitationIssue({ acquireIdToken });
  const sharing = useRef(false);
  const [isSharing, setIsSharing] = useState(false);
  const [sharingMessage, setSharingMessage] = useState<string | null>(null);
  const shareToLine = async (url: string) => {
    if (sharing.current || invitation.state.status !== "success") return;
    sharing.current = true;
    setIsSharing(true);
    setSharingMessage(null);
    try {
      const destination = await shareCompatibilityInvitationToLine(
        state.status === "success" ? state.data.displayName : null,
        invitation.state.data.relationshipCategory,
        url,
      );
      setSharingMessage(
        destination === "line"
          ? "LINEで招待を送信しました。"
          : destination === "system"
            ? "招待を共有しました。"
            : "送信をキャンセルしました。",
      );
    } catch (error) {
      setSharingMessage(error instanceof Error ? error.message : "LINEで共有できませんでした。");
    } finally {
      sharing.current = false;
      setIsSharing(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await copyCompatibilityInvitationUrl(url);
      setSharingMessage("招待リンクをコピーしました。");
    } catch (error) {
      setSharingMessage(
        error instanceof Error ? error.message : "リンクをコピーできませんでした。",
      );
    }
  };

  return (
    <CompatibilityShareScreen
      state={state}
      invitationState={invitation.state}
      isSharing={isSharing}
      sharingMessage={sharingMessage}
      relationshipCategory={relationshipCategory}
      onRelationshipCategoryChange={setRelationshipCategory}
      onIssue={() => void invitation.issue(relationshipCategory)}
      onRetry={() => void reload()}
      onShareToLine={(url) => void shareToLine(url)}
      onCopyLink={(url) => void copyLink(url)}
    />
  );
}
