import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { acceptCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import type { CompatibilityInvitationAcceptance } from "../../model/compatibility-relationship";

export function useCompatibilityInvitationAcceptance({
  acquireIdToken,
  relationshipId,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  relationshipId: string | null;
}) {
  const [state, setState] = useState<AsyncState<CompatibilityInvitationAcceptance>>({
    status: "idle",
  });
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const accept = useCallback(async () => {
    if (!relationshipId || state.status === "loading") return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const token = await acquireIdToken(controller.signal);
      if (!token) throw new Error("LINEから招待画面を開いてください。");
      const data = await acceptCompatibilityInvitation(
        config.apiUrl,
        token,
        relationshipId,
        controller.signal,
      );
      if (!controller.signal.aborted) setState({ status: "success", data });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "招待を承諾できませんでした。",
        });
      }
    }
  }, [acquireIdToken, relationshipId, state.status]);

  return { state, accept };
}
