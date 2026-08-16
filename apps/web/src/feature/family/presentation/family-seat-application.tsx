import { useCallback, useEffect, useMemo, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  acceptFamilyInvitation,
  cancelFamilyInvitation,
  declineFamilyInvitation,
  fetchFamilySeats,
  issueFamilyInvitation,
  leaveFamilyPack,
  removeFamilyMember,
} from "../infrastructure/family-api";
import type { FamilyInvitation, FamilySeatManagement } from "../model/family-seat";
import { FamilySeatScreen } from "./family-seat-screen";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作を完了できませんでした。";
}

function clearInvitationTokenFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function FamilySeatApplication({ onBack }: { onBack: () => void }) {
  const invitationToken = useMemo(
    () => new URLSearchParams(window.location.search).get("token"),
    [],
  );
  const [state, setState] = useState<AsyncState<FamilySeatManagement>>(
    invitationToken ? { status: "idle" } : { status: "loading" },
  );
  const [actionState, setActionState] = useState<AsyncState<string>>({ status: "idle" });
  const [issuedInvitation, setIssuedInvitation] = useState<FamilyInvitation | null>(null);
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const [isFreeAfterExit, setIsFreeAfterExit] = useState(false);

  const load = useCallback(async () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    try {
      setState({
        status: "success",
        data: await fetchFamilySeats(config.apiUrl, controller.signal),
      });
    } catch (error) {
      setState({ status: "error", message: message(error) });
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!invitationToken) void load();
  }, [invitationToken, load]);

  const run = async (operation: () => Promise<unknown>, done?: string) => {
    setActionState({ status: "loading" });
    try {
      await operation();
      setActionState({ status: "success", data: done ?? "更新しました。" });
      if (done) setCompletionMessage(done);
      return true;
    } catch (error) {
      setActionState({ status: "error", message: message(error) });
      return false;
    }
  };

  const issue = async () => {
    setActionState({ status: "loading" });
    try {
      const invitation = await issueFamilyInvitation(config.apiUrl);
      setIssuedInvitation(invitation);
      setActionState({ status: "success", data: "招待リンクを作成しました。" });
      await load();
    } catch (error) {
      setActionState({ status: "error", message: message(error) });
    }
  };

  const invitationLink = useMemo(() => {
    if (!issuedInvitation) return null;
    const url = new URL("/profile/family", window.location.origin);
    url.searchParams.set("token", issuedInvitation.token);
    return url.toString();
  }, [issuedInvitation]);

  const updateAndReload = async (operation: () => Promise<unknown>) => {
    if (await run(operation)) await load();
  };

  return (
    <FamilySeatScreen
      state={state}
      invitationToken={invitationToken}
      issuedInvitation={issuedInvitation}
      invitationLink={invitationLink}
      actionState={actionState}
      completionMessage={completionMessage}
      isFreeAfterExit={isFreeAfterExit}
      onBack={onBack}
      onRetry={() => void load()}
      onIssue={() => void issue()}
      onCopy={() => {
        if (invitationLink) void navigator.clipboard.writeText(invitationLink);
      }}
      onAccept={() => {
        if (!invitationToken) return;
        void (async () => {
          if (
            await run(
              () => acceptFamilyInvitation(config.apiUrl, invitationToken),
              "ファミリーパックに参加しました。",
            )
          ) {
            clearInvitationTokenFromUrl();
            await load();
          }
        })();
      }}
      onDecline={() => {
        if (!invitationToken) return;
        void (async () => {
          if (
            await run(
              () => declineFamilyInvitation(config.apiUrl, invitationToken),
              "招待を辞退しました。",
            )
          ) {
            clearInvitationTokenFromUrl();
            setIsFreeAfterExit(true);
          }
        })();
      }}
      onCancel={(seatId) =>
        void updateAndReload(() => cancelFamilyInvitation(config.apiUrl, seatId))
      }
      onRemove={(seatId) => void updateAndReload(() => removeFamilyMember(config.apiUrl, seatId))}
      onLeave={() =>
        void (async () => {
          if (
            await run(
              () => leaveFamilyPack(config.apiUrl),
              "ファミリーパックから退出し、Freeへ戻りました。",
            )
          ) {
            setIsFreeAfterExit(true);
          }
        })()
      }
    />
  );
}
