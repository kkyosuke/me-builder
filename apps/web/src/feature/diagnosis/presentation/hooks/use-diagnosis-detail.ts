import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import { OperationError } from "../../../../infrastructure/errors";
import {
  deferDiagnosisQuestion,
  fetchDiagnosisDefinition,
  fetchDiagnosisProgress,
  fetchDiagnosisResult,
} from "../../infrastructure/diagnosis-api";
import { restoreDiagnosisProgress } from "../../model/answers";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import {
  type DiagnosisDestination,
  resolveDiagnosisDestination,
} from "../../model/diagnosis-navigation";
import type { DiagnosisResult } from "../../model/diagnosis-result";
import type { DiagnosisAnswer } from "../../model/types";
import { useDiagnosisAnswerSaver } from "./use-diagnosis-answer-saver";

const MINIMUM_LOADING_MS = 400;

const waitForMinimumLoading = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, MINIMUM_LOADING_MS));

export type GuidanceKind = "closed" | "unsupported" | "invalid-link" | "load-error";

type DiagnosisDetailContent =
  | { type: "answer"; diagnosis: DiagnosisDefinition; initialAnswers: DiagnosisAnswer[] }
  | { type: "result"; result: DiagnosisResult }
  | { type: "guidance"; kind: Exclude<GuidanceKind, "load-error"> };

type DiagnosisDetailState =
  | { status: "idle" }
  | { status: "loading"; destination: Exclude<DiagnosisDestination, "closed"> }
  | { status: "success"; data: DiagnosisDetailContent }
  | { status: "error"; message: string };

interface UseDiagnosisDetailOptions {
  idToken: string | null;
  onProgress: (
    diagnosisId: string,
    progress: Pick<DiagnosisListItem, "responseStatus" | "answeredCount" | "questionCount">,
  ) => void;
}

export function useDiagnosisDetail({ idToken, onProgress }: UseDiagnosisDetailOptions) {
  const [state, setState] = useState<DiagnosisDetailState>({ status: "idle" });
  const selectedDefinition = useRef<DiagnosisDefinition | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const answerSaver = useDiagnosisAnswerSaver({ idToken, onProgress });

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
    async (diagnosis: DiagnosisListItem): Promise<void> => {
      selectedDefinition.current = null;
      const destination = resolveDiagnosisDestination(diagnosis);
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
      setState({ status: "loading", destination });
      const minimumLoading = waitForMinimumLoading();
      try {
        await answerSaver.waitForPendingSaves(diagnosis.id);
        if (controller.signal.aborted) {
          return;
        }

        if (destination === "result") {
          const result = await fetchDiagnosisResult(
            config.apiUrl,
            idToken,
            diagnosis.id,
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
          fetchDiagnosisDefinition(config.apiUrl, idToken, diagnosis.id, controller.signal),
          fetchDiagnosisProgress(config.apiUrl, idToken, diagnosis.id, controller.signal),
        ]);
        await minimumLoading;
        if (!controller.signal.aborted && mounted.current) {
          const restored = savedResult
            ? restoreDiagnosisProgress(definition.questions, savedResult.answers)
            : undefined;
          selectedDefinition.current = definition;
          setState({
            status: "success",
            data: {
              type: "answer",
              diagnosis: definition,
              initialAnswers: restored?.answers ?? [],
            },
          });
        }
      } catch (error) {
        await minimumLoading;
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        if (error instanceof OperationError && error.code === "DIAGNOSIS_UNAVAILABLE") {
          setState({ status: "success", data: { type: "guidance", kind: "unsupported" } });
        } else if (error instanceof OperationError && error.code === "DIAGNOSIS_CLOSED") {
          setState({ status: "success", data: { type: "guidance", kind: "closed" } });
        } else {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "診断を読み込めませんでした。",
          });
        }
      }
    },
    [answerSaver.waitForPendingSaves, idToken],
  );

  const saveAnswer = useCallback(
    async (answer: DiagnosisAnswer) => {
      const definition = selectedDefinition.current;
      if (!idToken || !definition) {
        throw new Error("本人確認情報を取得できませんでした。LINEから開き直してください。");
      }
      return answerSaver.save(definition, answer);
    },
    [answerSaver.save, idToken],
  );

  const deferQuestion = useCallback(
    async (diagnosisQuestionId: string): Promise<void> => {
      const definition = selectedDefinition.current;
      if (!idToken || !definition) {
        throw new Error("本人確認情報を取得できませんでした。LINEから開き直してください。");
      }
      await deferDiagnosisQuestion(config.apiUrl, idToken, definition.id, diagnosisQuestionId);
      close();
    },
    [close, idToken],
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
    setState({ status: "loading", destination: "result" });
    const minimumLoading = waitForMinimumLoading();
    const completedProgress = {
      responseStatus: "answered" as const,
      answeredCount: definition.questions.length,
      questionCount: definition.questions.length,
    };
    try {
      const result = await fetchDiagnosisResult(
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
          message: error instanceof Error ? error.message : "診断結果を読み込めませんでした。",
        });
      }
    }
  }, [idToken, onProgress]);

  return { state, open, close, saveAnswer, deferQuestion, openCompletedResult };
}
