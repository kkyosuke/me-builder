import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import { OperationError } from "../../../../infrastructure/errors";
import type { AsyncState } from "../../../../model/async-state";
import {
  fetchSurveyDefinition,
  fetchSurveyProgress,
  fetchSurveyResult,
} from "../../infrastructure/survey-api";
import { restoreSurveyProgress } from "../../model/answers";
import type { SurveyDefinition } from "../../model/survey-definition";
import type { SurveyListItem } from "../../model/survey-list-item";
import { resolveSurveyDestination } from "../../model/survey-navigation";
import type { SurveyResult } from "../../model/survey-result";
import type { SurveyAnswer } from "../../model/types";
import { useSurveyAnswerSaver } from "./use-survey-answer-saver";

const MINIMUM_LOADING_MS = 400;

const waitForMinimumLoading = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, MINIMUM_LOADING_MS));

export type GuidanceKind = "closed" | "unsupported" | "load-error";

export type SurveyDetailContent =
  | { type: "answer"; survey: SurveyDefinition; initialAnswers: SurveyAnswer[] }
  | { type: "result"; result: SurveyResult }
  | { type: "guidance"; kind: Exclude<GuidanceKind, "load-error"> };

interface UseSurveyDetailOptions {
  idToken: string | null;
  onProgress: (
    surveyId: string,
    progress: Pick<SurveyListItem, "responseStatus" | "answeredCount" | "questionCount">,
  ) => void;
}

export function useSurveyDetail({ idToken, onProgress }: UseSurveyDetailOptions) {
  const [state, setState] = useState<AsyncState<SurveyDetailContent>>({ status: "idle" });
  const selectedDefinition = useRef<SurveyDefinition | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const answerSaver = useSurveyAnswerSaver({ idToken, onProgress });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const close = useCallback(() => {
    request.current?.abort();
    selectedDefinition.current = null;
    setState({ status: "idle" });
  }, []);

  const open = useCallback(
    async (survey: SurveyListItem): Promise<void> => {
      selectedDefinition.current = null;
      const destination = resolveSurveyDestination(survey);
      if (destination === "closed") {
        setState({ status: "success", data: { type: "guidance", kind: "closed" } });
        return;
      }
      if (!idToken) {
        setState({
          status: "error",
          message: "本人確認情報を取得できませんでした。LINEから開き直してください。",
        });
        return;
      }

      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setState({ status: "loading" });
      const minimumLoading = waitForMinimumLoading();
      try {
        await answerSaver.waitForPendingSaves(survey.id);
        if (controller.signal.aborted) {
          return;
        }

        if (destination === "result") {
          const result = await fetchSurveyResult(
            config.apiUrl,
            idToken,
            survey.id,
            controller.signal,
          );
          await minimumLoading;
          if (!controller.signal.aborted && mounted.current) {
            setState(
              result
                ? { status: "success", data: { type: "result", result } }
                : { status: "success", data: { type: "guidance", kind: "unsupported" } },
            );
          }
          return;
        }

        const [definition, savedResult] = await Promise.all([
          fetchSurveyDefinition(config.apiUrl, idToken, survey.id, controller.signal),
          fetchSurveyProgress(config.apiUrl, idToken, survey.id, controller.signal),
        ]);
        await minimumLoading;
        if (!controller.signal.aborted && mounted.current) {
          if (!definition) {
            setState({ status: "success", data: { type: "guidance", kind: "unsupported" } });
            return;
          }
          const restored = savedResult
            ? restoreSurveyProgress(definition.questions, savedResult.answers)
            : undefined;
          selectedDefinition.current = definition;
          setState({
            status: "success",
            data: { type: "answer", survey: definition, initialAnswers: restored?.answers ?? [] },
          });
        }
      } catch (error) {
        await minimumLoading;
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        if (error instanceof OperationError && error.code === "SURVEY_UNAVAILABLE") {
          setState({ status: "success", data: { type: "guidance", kind: "unsupported" } });
        } else if (error instanceof OperationError && error.code === "SURVEY_CLOSED") {
          setState({ status: "success", data: { type: "guidance", kind: "closed" } });
        } else {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "アンケートを読み込めませんでした。",
          });
        }
      }
    },
    [answerSaver.waitForPendingSaves, idToken],
  );

  const saveAnswer = useCallback(
    async (answer: SurveyAnswer) => {
      const definition = selectedDefinition.current;
      if (!idToken || !definition) {
        throw new Error("本人確認情報を取得できませんでした。LINEから開き直してください。");
      }
      return answerSaver.save(definition, answer);
    },
    [answerSaver.save, idToken],
  );

  const openCompletedResult = useCallback(async (): Promise<void> => {
    const definition = selectedDefinition.current;
    if (!idToken || !definition) {
      setState({
        status: "error",
        message: "本人確認情報を取得できませんでした。LINEから開き直してください。",
      });
      return;
    }

    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    const minimumLoading = waitForMinimumLoading();
    const completedProgress = {
      responseStatus: "answered" as const,
      answeredCount: definition.questions.length,
      questionCount: definition.questions.length,
    };
    try {
      const result = await fetchSurveyResult(
        config.apiUrl,
        idToken,
        definition.id,
        controller.signal,
      );
      await minimumLoading;
      if (controller.signal.aborted || !mounted.current) {
        return;
      }
      onProgress(definition.id, completedProgress);
      setState(
        result
          ? { status: "success", data: { type: "result", result } }
          : { status: "success", data: { type: "guidance", kind: "unsupported" } },
      );
    } catch (error) {
      await minimumLoading;
      if (!controller.signal.aborted && mounted.current) {
        onProgress(definition.id, completedProgress);
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "アンケート結果を読み込めませんでした。",
        });
      }
    }
  }, [idToken, onProgress]);

  return { state, open, close, saveAnswer, openCompletedResult };
}
