import { useState } from "react";
import { useLiffSession } from "../../liff";
import {
  copyCompatibilityInvitationUrl,
  shareCompatibilityInvitationToLine,
} from "../infrastructure/compatibility-invitation-sharing";
import { CompatibilityShareScreen } from "./compatibility-share-screen";
import { useCompatibilityInvitationIssue } from "./hooks/use-compatibility-invitation-issue";
import { useCompatibilitySharePreview } from "./hooks/use-compatibility-share-preview";

export default function CompatibilityShareApplication() {
  const { acquireIdToken } = useLiffSession();
  const { state, reload } = useCompatibilitySharePreview({ acquireIdToken });
  const invitation = useCompatibilityInvitationIssue({ acquireIdToken });
  const [sharingMessage, setSharingMessage] = useState<string | null>(null);

  const shareToLine = async (url: string) => {
    try {
      await shareCompatibilityInvitationToLine(
        state.status === "success" ? state.data.displayName : null,
        url,
      );
      setSharingMessage("LINEの共有先を開きました。");
    } catch (error) {
      setSharingMessage(error instanceof Error ? error.message : "LINEで共有できませんでした。");
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
      sharingMessage={sharingMessage}
      onIssue={(previewToken) => void invitation.issue(previewToken)}
      onRetry={() => void reload()}
      onShareToLine={(url) => void shareToLine(url)}
      onCopyLink={(url) => void copyLink(url)}
    />
  );
}
