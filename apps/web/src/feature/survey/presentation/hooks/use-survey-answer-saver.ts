import { useCallback, useRef } from "react";
import { config } from "../../../../config";
import { saveSurveyAnswer } from "../../infrastructure/survey-api";
import type { SurveyDefinition } from "../../model/survey-definition";
import type { SurveyListItem } from "../../model/survey-list-item";
import type { SurveyAnswer } from "../../model/types";

export function useSurveyAnswerSaver({
  idToken,
  onProgress,
}: {
  idToken: string | null;
  onProgress: (
    surveyId: string,
    progress: Pick<SurveyListItem, "responseStatus" | "answeredCount" | "questionCount">,
  ) => void;
}) {
  const pendingSaves = useRef(new Map<string, Set<Promise<void>>>());

  const waitForPendingSaves = useCallback(async (surveyId: string): Promise<void> => {
    const saves = pendingSaves.current.get(surveyId);
    if (saves && saves.size > 0) {
      await Promise.all([...saves]);
    }
  }, []);

  const save = useCallback(
    async (definition: SurveyDefinition, answer: SurveyAnswer) => {
      if (!idToken) {
        throw new Error("本人確認情報を取得できませんでした。LINEから開き直してください。");
      }
      const saveRequest = saveSurveyAnswer(
        config.apiUrl,
        idToken,
        definition.id,
        answer.surveyQuestionId,
        answer.choiceId,
      );
      const settledSave = saveRequest.then(
        () => undefined,
        () => undefined,
      );
      const saves = pendingSaves.current.get(definition.id) ?? new Set();
      saves.add(settledSave);
      pendingSaves.current.set(definition.id, saves);
      try {
        const result = await saveRequest;
        onProgress(definition.id, result.progress);
        return { acceptedAt: result.answer.acceptedAt };
      } finally {
        saves.delete(settledSave);
        if (saves.size === 0) {
          pendingSaves.current.delete(definition.id);
        }
      }
    },
    [idToken, onProgress],
  );

  return { save, waitForPendingSaves };
}
