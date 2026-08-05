import type { DiagnosisListItem } from "./diagnosis-list-item";

export type DiagnosisDestination = "answer" | "result" | "closed";

export function resolveDiagnosisDestination(diagnosis: DiagnosisListItem): DiagnosisDestination {
  if (diagnosis.responseStatus === "answered") {
    return "result";
  }
  if (diagnosis.availability === "closed") {
    return "closed";
  }
  return "answer";
}

export function applySavedProgress(
  diagnosis: DiagnosisListItem,
  progress: Pick<DiagnosisListItem, "responseStatus" | "answeredCount" | "questionCount"> & {
    lastAnsweredAt?: string;
  },
): DiagnosisListItem {
  // バックグラウンド保存のレスポンス順が前後しても進捗を巻き戻さない。
  const answeredCount = Math.max(diagnosis.answeredCount, progress.answeredCount);
  const questionCount = progress.questionCount;
  return {
    ...diagnosis,
    responseStatus: answeredCount === questionCount ? "answered" : "in-progress",
    answeredCount,
    questionCount,
    lastAnsweredAt:
      progress.lastAnsweredAt && progress.lastAnsweredAt > (diagnosis.lastAnsweredAt ?? "")
        ? progress.lastAnsweredAt
        : diagnosis.lastAnsweredAt,
  };
}
