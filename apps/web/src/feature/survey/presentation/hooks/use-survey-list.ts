import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { fetchSurveyList } from "../../infrastructure/survey-api";
import type { SurveyListItem } from "../../model/survey-list-item";
import { applySavedProgress } from "../../model/survey-navigation";

export function useSurveyList({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<SurveyListItem[]>>({ status: "loading" });
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

      const surveys = await fetchSurveyList(config.apiUrl, currentIdToken, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setState({ status: "success", data: surveys });
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
      surveyId: string,
      progress: Pick<SurveyListItem, "responseStatus" | "answeredCount" | "questionCount">,
    ) => {
      setState((current) =>
        current.status === "success"
          ? {
              status: "success",
              data: current.data.map((survey) =>
                survey.id === surveyId ? applySavedProgress(survey, progress) : survey,
              ),
            }
          : current,
      );
    },
    [],
  );

  return { state, idToken, load, updateProgress };
}
