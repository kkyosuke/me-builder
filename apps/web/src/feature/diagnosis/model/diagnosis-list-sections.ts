import type { DiagnosisListItem } from "./diagnosis-list-item";

export type DiagnosisListSections = Readonly<{
  inProgress: DiagnosisListItem[];
  unanswered: DiagnosisListItem[];
  answered: DiagnosisListItem[];
}>;

const compareDisplayOrder = (left: DiagnosisListItem, right: DiagnosisListItem) =>
  left.displayOrder - right.displayOrder || left.id.localeCompare(right.id);

/** 回答状態ごとに一覧を分け、画面で定義された優先順へ安定して並べる。 */
export function buildDiagnosisListSections(diagnoses: DiagnosisListItem[]): DiagnosisListSections {
  const inProgress = diagnoses
    .filter(({ responseStatus }) => responseStatus === "in-progress")
    .sort(
      (left, right) => right.answeredCount - left.answeredCount || compareDisplayOrder(left, right),
    );
  const unanswered = diagnoses
    .filter(({ responseStatus }) => responseStatus === "unanswered")
    .sort(compareDisplayOrder);
  const answered = diagnoses
    .filter(({ responseStatus }) => responseStatus === "answered")
    .sort(
      (left, right) =>
        (right.lastAnsweredAt ?? "").localeCompare(left.lastAnsweredAt ?? "") ||
        compareDisplayOrder(left, right),
    );

  return { inProgress, unanswered, answered };
}
