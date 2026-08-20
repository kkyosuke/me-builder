export const LIKERT_5_LABELS = [
  "まったく当てはまらない",
  "あまり当てはまらない",
  "どちらともいえない",
  "やや当てはまる",
  "とても当てはまる",
] as const;

export const LIKERT_5_SCORES = [-1, -0.5, 0, 0.5, 1] as const;

export type DiagnosisQuestionFormat = "single_choice" | "likert_5";
