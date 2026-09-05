import type { RelationshipCategory } from "./relationship-category";

interface DiagnosisResultAnswerBase {
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  questionText: string;
  choiceId: string;
  choiceLabel: string;
  acceptedAt: string;
}

export type DiagnosisResultAnswer = DiagnosisResultAnswerBase &
  (
    | { perspective: "single"; pairId: null }
    | { perspective: "behavior" | "desired"; pairId: string }
  );

export interface ParameterScore {
  score: number | null;
  coverage: number;
  band: "low" | "balanced" | "high" | "insufficient";
}

interface ScoredParameterBase extends ParameterScore {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
}

interface ParameterComparison {
  difference: number;
  relation: "same_band" | "desired_higher" | "behavior_higher";
}

export type ScoredParameter = ScoredParameterBase &
  (
    | { resultKind: "aggregate"; behavior: null; comparison: null }
    | {
        resultKind: "behavior_desired";
        behavior: ParameterScore;
        comparison: ParameterComparison | null;
      }
  );

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
