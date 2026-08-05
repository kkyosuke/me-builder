import type { ParameterProfile } from "./scoring";

export interface DiagnosisResultAnswer {
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  questionText: string;
  choiceId: string;
  choiceLabel: string;
  acceptedAt: string;
}

/** 保存済み回答と、それらから決定的に再計算した表示用プロフィール。 */
export interface DiagnosisResult {
  id: string;
  title: string;
  description: string;
  responseStatus: "in-progress" | "answered";
  answeredCount: number;
  questionCount: number;
  answers: DiagnosisResultAnswer[];
  balancedLabel: string;
  profile: ParameterProfile<string>;
}
