import type { SurveyListItem } from "./survey-list-item";

export type SurveyDestination = "answer" | "result" | "closed";

export function resolveSurveyDestination(survey: SurveyListItem): SurveyDestination {
  if (survey.responseStatus === "answered") {
    return "result";
  }
  if (survey.availability === "closed") {
    return "closed";
  }
  return "answer";
}

export function applySavedProgress(
  survey: SurveyListItem,
  progress: Pick<SurveyListItem, "responseStatus" | "answeredCount" | "questionCount">,
): SurveyListItem {
  // バックグラウンド保存のレスポンス順が前後しても進捗を巻き戻さない。
  const answeredCount = Math.max(survey.answeredCount, progress.answeredCount);
  const questionCount = progress.questionCount;
  return {
    ...survey,
    responseStatus: answeredCount === questionCount ? "answered" : "in-progress",
    answeredCount,
    questionCount,
  };
}
