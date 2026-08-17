import { useCallback, useRef } from "react";
import { config } from "../../../../config";
import { saveDiagnosisAnswer } from "../../infrastructure/diagnosis-api";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import type { DiagnosisAnswer } from "../../model/types";

export function useDiagnosisAnswerSaver({
  onProgress,
}: {
  onProgress: (
    diagnosisId: string,
    progress: Pick<DiagnosisListItem, "responseStatus" | "answeredCount" | "questionCount"> & {
      lastAnsweredAt?: string;
    },
  ) => void;
}) {
  const pendingSaves = useRef(new Map<string, Set<Promise<void>>>());

  const waitForPendingSaves = useCallback(async (diagnosisId: string): Promise<void> => {
    const saves = pendingSaves.current.get(diagnosisId);
    if (saves && saves.size > 0) {
      await Promise.all([...saves]);
    }
  }, []);

  const save = useCallback(
    async (definition: DiagnosisDefinition, answer: DiagnosisAnswer) => {
      const saveRequest = saveDiagnosisAnswer(
        config.apiUrl,
        definition.id,
        answer.diagnosisQuestionId,
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
        onProgress(definition.id, {
          ...result.progress,
          lastAnsweredAt: result.answer.acceptedAt,
        });
        return { acceptedAt: result.answer.acceptedAt };
      } finally {
        saves.delete(settledSave);
        if (saves.size === 0) {
          pendingSaves.current.delete(definition.id);
        }
      }
    },
    [onProgress],
  );

  return { save, waitForPendingSaves };
}
