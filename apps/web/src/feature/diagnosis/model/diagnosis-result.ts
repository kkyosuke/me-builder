import type { RelationshipCategory } from "./relationship-category";

export interface DiagnosisResultAnswer {
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  questionText: string;
  choiceId: string;
  choiceLabel: string;
  acceptedAt: string;
}

export interface ScoredParameter {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  score: number | null;
  coverage: number;
  band: "low" | "balanced" | "high" | "insufficient";
}

interface DiagnosisScoring {
  scoringVersion: number;
  balancedLabel: string;
  parameters: ScoredParameter[];
}

/** APIが返す保存済み回答と計算済みの表示用プロフィール。 */
export interface DiagnosisResult {
  id: string;
  title: string;
  description: string;
  relationshipCategory: RelationshipCategory;
  responseStatus: "in-progress" | "answered";
  answeredCount: number;
  questionCount: number;
  answers: DiagnosisResultAnswer[];
  scoring: DiagnosisScoring | null;
}
