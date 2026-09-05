import type { RelationshipCategory } from "./relationship-category";

export interface DiagnosisResultAnswer {
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  questionText: string;
  choiceId: string;
  choiceLabel: string;
  acceptedAt: string;
  perspective: "single" | "behavior" | "desired";
  pairId: string | null;
}

export interface ParameterScore {
  score: number | null;
  coverage: number;
  band: "low" | "balanced" | "high" | "insufficient";
}

export interface ScoredParameter extends ParameterScore {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  resultKind: "aggregate" | "behavior_desired";
  behavior: ParameterScore | null;
  comparison: {
    difference: number;
    relation: "same_band" | "desired_higher" | "behavior_higher";
  } | null;
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
