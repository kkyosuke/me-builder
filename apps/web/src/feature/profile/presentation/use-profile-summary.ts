import { useCallback, useEffect, useRef, useState } from "react";
import type { AsyncState } from "../../../model/async-state";
import { loadProfileRecords } from "../infrastructure/dummy-profile-records";
import { generateProfileSummary } from "../model/generate-profile-summary";
import type { ProfileSummary } from "../model/profile-summary";

export function useProfileSummary() {
  const [state, setState] = useState<AsyncState<ProfileSummary>>({ status: "loading" });
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const records = await loadProfileRecords(controller.signal);
      if (!controller.signal.aborted) {
        setState({ status: "success", data: generateProfileSummary(records) });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "まとめを生成できませんでした。",
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);

  return { state, reload: load };
}
