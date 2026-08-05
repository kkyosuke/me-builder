import type { ParameterProfile } from "./scoring";

export interface SurveyResultAnswer {
  surveyQuestionId: string;
  questionId: string;
  questionVersion: number;
  questionText: string;
  choiceId: string;
  choiceLabel: string;
  acceptedAt: string;
}

/** 保存済み回答と、それらから決定的に再計算した表示用プロフィール。 */
export interface SurveyResult {
  id: string;
  title: string;
  description: string;
  responseStatus: "in-progress" | "answered";
  answeredCount: number;
  questionCount: number;
  answers: SurveyResultAnswer[];
  balancedLabel: string;
  profile: ParameterProfile<string>;
}
