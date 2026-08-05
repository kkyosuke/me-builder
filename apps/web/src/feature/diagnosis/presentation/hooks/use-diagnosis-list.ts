import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { fetchDiagnosisList } from "../../infrastructure/diagnosis-api";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import { applySavedProgress } from "../../model/diagnosis-navigation";

export function useDiagnosisList({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<DiagnosisListItem[]>>({ status: "loading" });
  const [idToken, setIdToken] = useState<string | null>(null);
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (loading.current) {
      return;
    }
    loading.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) {
      setState({ status: "loading" });
    }

    try {
      const currentIdToken = await acquireIdToken(controller.signal);
      if (controller.signal.aborted || !currentIdToken) {
        return;
      }
      setIdToken(currentIdToken);

      const diagnoses = await fetchDiagnosisList(config.apiUrl, currentIdToken, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setState({ status: "success", data: diagnoses });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (request.current === controller) {
        loading.current = false;
      }
    }
  }, [acquireIdToken]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void load();
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      request.current?.abort();
      loading.current = false;
    };
  }, [load]);

  const updateProgress = useCallback(
    (
      diagnosisId: string,
      progress: Pick<DiagnosisListItem, "responseStatus" | "answeredCount" | "questionCount"> & {
        lastAnsweredAt?: string;
      },
    ) => {
      setState((current) =>
        current.status === "success"
          ? {
              status: "success",
              data: current.data.map((diagnosis) =>
                diagnosis.id === diagnosisId ? applySavedProgress(diagnosis, progress) : diagnosis,
              ),
            }
          : current,
      );
    },
    [],
  );

  return { state, idToken, load, updateProgress };
}
