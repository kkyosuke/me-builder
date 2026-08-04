/** アンケート一覧に表示する、回答進捗を含む概要。 */
export interface SurveyListItem {
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string | null;
  availability: "open" | "closed";
  responseStatus: "unanswered" | "in-progress" | "answered";
  answeredCount: number;
  questionCount: number;
}
