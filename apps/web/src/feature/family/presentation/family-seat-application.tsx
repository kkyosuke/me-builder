import { useCallback, useEffect, useMemo, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { getLiffIdToken } from "../../liff/infrastructure/liff-client";
import { useLiffSession } from "../../liff/presentation/liff-session-provider";
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

export default function FamilySeatApplication({ onBack }: { onBack: () => void }) {
  const { acquireIdToken } = useLiffSession();
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

  const token = useCallback(
    async (signal?: AbortSignal) => {
      const value =
        getLiffIdToken() ?? (await acquireIdToken(signal ?? new AbortController().signal));
      if (!value) throw new Error("LINEからプロフィールを開き直してください。");
      return value;
    },
    [acquireIdToken],
  );

  const load = useCallback(async () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    try {
      setState({
        status: "success",
        data: await fetchFamilySeats(
          config.apiUrl,
          await token(controller.signal),
          controller.signal,
        ),
      });
    } catch (error) {
      setState({ status: "error", message: message(error) });
    }
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!invitationToken) void load();
  }, [invitationToken, load]);

  const run = async (operation: (idToken: string) => Promise<unknown>, done?: string) => {
    setActionState({ status: "loading" });
    try {
      await operation(await token());
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
      const invitation = await issueFamilyInvitation(config.apiUrl, await token());
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

  const updateAndReload = async (operation: (idToken: string) => Promise<unknown>) => {
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
              (idToken) => acceptFamilyInvitation(config.apiUrl, idToken, invitationToken),
              "ファミリーパックに参加しました。",
            )
          ) {
            await load();
          }
        })();
      }}
      onDecline={() => {
        if (!invitationToken) return;
        void (async () => {
          if (
            await run(
              (idToken) => declineFamilyInvitation(config.apiUrl, idToken, invitationToken),
              "招待を辞退しました。",
            )
          ) {
            setIsFreeAfterExit(true);
          }
        })();
      }}
      onCancel={(seatId) =>
        void updateAndReload((idToken) => cancelFamilyInvitation(config.apiUrl, idToken, seatId))
      }
      onRemove={(seatId) =>
        void updateAndReload((idToken) => removeFamilyMember(config.apiUrl, idToken, seatId))
      }
      onLeave={() =>
        void (async () => {
          if (
            await run(
              (idToken) => leaveFamilyPack(config.apiUrl, idToken),
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
