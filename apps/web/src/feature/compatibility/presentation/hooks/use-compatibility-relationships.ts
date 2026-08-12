import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import {
  cancelCompatibilityInvitation,
  fetchCompatibilityRelationships,
} from "../../infrastructure/compatibility-api";
import type { CompatibilityRelationshipList } from "../../model/compatibility-relationship";

type AcquireIdToken = (signal: AbortSignal) => Promise<string | null>;

export function useCompatibilityRelationships({
  acquireIdToken,
}: {
  acquireIdToken: AcquireIdToken;
}) {
  const [state, setState] = useState<AsyncState<CompatibilityRelationshipList>>({
    status: "loading",
  });
  const [operation, setOperation] = useState<AsyncState<string>>({ status: "idle" });
  const request = useRef<AbortController | null>(null);
  const operationRequest = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const token = await acquireIdToken(controller.signal);
      if (!token) throw new Error("LINEから相性画面を開いてください。");
      const data = await fetchCompatibilityRelationships(config.apiUrl, token, controller.signal);
      if (!controller.signal.aborted) setState({ status: "success", data });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "相性一覧を読み込めませんでした。",
        });
      }
    }
  }, [acquireIdToken]);

  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      operationRequest.current?.abort();
    };
  }, [load]);

  const cancel = useCallback(
    async (relationshipId: string) => {
      operationRequest.current?.abort();
      const controller = new AbortController();
      operationRequest.current = controller;
      setOperation({ status: "loading" });
      try {
        const token = await acquireIdToken(controller.signal);
        if (!token) throw new Error("LINEから相性画面を開いてください。");
        await cancelCompatibilityInvitation(
          config.apiUrl,
          token,
          relationshipId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setOperation({ status: "success", data: "招待を取り消しました。" });
        await load();
      } catch (error) {
        if (!controller.signal.aborted) {
          setOperation({
            status: "error",
            message: error instanceof Error ? error.message : "招待を取り消せませんでした。",
          });
        }
      }
    },
    [acquireIdToken, load],
  );

  return { state, operation, reload: load, cancel };
}
