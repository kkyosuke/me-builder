import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { issueCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import type { CompatibilityInvitation } from "../../model/compatibility-invitation";

export function useCompatibilityInvitationIssue() {
  const [state, setState] = useState<AsyncState<CompatibilityInvitation>>({ status: "idle" });
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const issue = useCallback(async (relationshipCategory: CompatibilityRelationshipCategory) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const invitation = await issueCompatibilityInvitation(
        config.apiUrl,
        relationshipCategory,
        controller.signal,
      );
      if (!controller.signal.aborted) setState({ status: "success", data: invitation });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "招待リンクを発行できませんでした。",
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, []);

  return { state, issue };
}
