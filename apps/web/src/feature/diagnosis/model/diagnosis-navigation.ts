import type { DiagnosisListItem } from "./diagnosis-list-item";

export type DiagnosisDestination = "answer" | "result" | "answers" | "closed";

const DIAGNOSIS_DETAIL_HISTORY_STATE_KEY = "me-builder-diagnosis-detail-id";

export function diagnosisDetailIdFromHistoryState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[DIAGNOSIS_DETAIL_HISTORY_STATE_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createDiagnosisDetailHistoryState(
  currentState: unknown,
  diagnosisId: string,
): Record<string, unknown> {
  const state =
    currentState && typeof currentState === "object" && !Array.isArray(currentState)
      ? (currentState as Record<string, unknown>)
      : {};
  return { ...state, [DIAGNOSIS_DETAIL_HISTORY_STATE_KEY]: diagnosisId };
}

export function isDiagnosisResultPathname(pathname: string): boolean {
  return /^\/diagnosis\/[^/]+\/answers\/?$/.test(pathname);
}

export function diagnosisEntryIdFromPathname(pathname: string): string | null {
  const encodedId = pathname.match(/^\/diagnosis\/([^/]+)\/?$/)?.[1];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

export function diagnosisResultIdFromPathname(pathname: string): string | null {
  if (!isDiagnosisResultPathname(pathname)) return null;
  const encodedId = pathname.match(/^\/diagnosis\/([^/]+)\/answers\/?$/)?.[1];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

export function resolveDiagnosisDestination(diagnosis: DiagnosisListItem): DiagnosisDestination {
  if (diagnosis.responseStatus === "answered") {
    return "result";
  }
  if (diagnosis.availability === "closed") {
    return diagnosis.answeredCount > 0 ? "answers" : "closed";
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
    // API/AccountData側のresponseStatus導出と対応。生成型を保つためWeb内で再計算する。
    responseStatus: answeredCount === questionCount ? "answered" : "in-progress",
    answeredCount,
    questionCount,
    lastAnsweredAt:
      progress.lastAnsweredAt && progress.lastAnsweredAt > (diagnosis.lastAnsweredAt ?? "")
        ? progress.lastAnsweredAt
        : diagnosis.lastAnsweredAt,
  };
}
