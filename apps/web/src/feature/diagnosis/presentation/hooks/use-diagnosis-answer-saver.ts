import { useCallback, useEffect, useRef, useState } from "react";
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
  const saves = useRef(
    new Map<
      string,
      Map<string, { state: "pending"; promise: Promise<void> } | { state: "failed" }>
    >(),
  );
  const [unsavedCount, setUnsavedCount] = useState(0);

  const updateUnsavedCount = useCallback(() => {
    setUnsavedCount(
      [...saves.current.values()].reduce((count, diagnosisSaves) => {
        return count + diagnosisSaves.size;
      }, 0),
    );
  }, []);

  useEffect(() => {
    if (unsavedCount === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [unsavedCount]);

  const waitForPendingSaves = useCallback(async (diagnosisId: string): Promise<boolean> => {
    const diagnosisSaves = saves.current.get(diagnosisId);
    const pending = diagnosisSaves
      ? [...diagnosisSaves.values()].flatMap((save) =>
          save.state === "pending" ? [save.promise] : [],
        )
      : [];
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
    return (saves.current.get(diagnosisId)?.size ?? 0) === 0;
  }, []);

  const hasUnsavedSaves = useCallback(
    (diagnosisId: string): boolean => (saves.current.get(diagnosisId)?.size ?? 0) > 0,
    [],
  );

  const save = useCallback(
    async (definition: DiagnosisDefinition, answer: DiagnosisAnswer) => {
      const saveRequest = saveDiagnosisAnswer(
        config.apiUrl,
        definition.id,
        answer.diagnosisQuestionId,
        answer.choiceId,
        { keepalive: true },
      );
      const trackedSave = saveRequest.then(
        () => undefined,
        () => undefined,
      );
      const diagnosisSaves = saves.current.get(definition.id) ?? new Map();
      diagnosisSaves.set(answer.diagnosisQuestionId, {
        state: "pending",
        promise: trackedSave,
      });
      saves.current.set(definition.id, diagnosisSaves);
      updateUnsavedCount();
      try {
        const result = await saveRequest;
        onProgress(definition.id, {
          ...result.progress,
          lastAnsweredAt: result.answer.acceptedAt,
        });
        diagnosisSaves.delete(answer.diagnosisQuestionId);
        return { acceptedAt: result.answer.acceptedAt };
      } catch (error) {
        diagnosisSaves.set(answer.diagnosisQuestionId, { state: "failed" });
        throw error;
      } finally {
        if (diagnosisSaves.size === 0) {
          saves.current.delete(definition.id);
        }
        updateUnsavedCount();
      }
    },
    [onProgress, updateUnsavedCount],
  );

  return { hasUnsavedSaves, save, waitForPendingSaves };
}
