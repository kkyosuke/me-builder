import { MONEY_VALUES_SCORING_CONFIG, scoreMoneyValues } from "../model/definitions/money-values";
import {
  RELATIONSHIP_PRIORITY_SCORING_CONFIG,
  scoreRelationshipPriority,
} from "../model/definitions/relationship-priority";
import type { DiagnosisDefinition } from "../model/diagnosis-definition";
import type { DiagnosisResult, DiagnosisResultAnswer } from "../model/diagnosis-result";
import type { DiagnosisQuestion } from "../model/types";

type LocalDiagnosisPresentation = Pick<DiagnosisDefinition, "balancedLabel" | "score">;

/**
 * スコア関数と表示メタデータだけをローカルに残し、配信内容は詳細APIを正とします。
 * スコア設定を版付きでAPI配信するか、サーバーが計算結果を返す段階でこの対応表は不要になります。
 */
const LOCAL_PRESENTATION: Record<string, LocalDiagnosisPresentation> = {
  "relationship-priority": {
    balancedLabel: RELATIONSHIP_PRIORITY_SCORING_CONFIG.balancedLabel,
    score: scoreRelationshipPriority,
  },
  "money-values": {
    balancedLabel: MONEY_VALUES_SCORING_CONFIG.balancedLabel,
    score: scoreMoneyValues,
  },
};

export function combineDiagnosisDefinition(input: {
  id: string;
  title: string;
  description: string;
  questions: DiagnosisQuestion[];
}): DiagnosisDefinition | undefined {
  const presentation = LOCAL_PRESENTATION[input.id];
  return presentation ? { ...input, ...presentation } : undefined;
}

export function combineDiagnosisResult(
  input: Omit<DiagnosisResult, "balancedLabel" | "profile">,
): DiagnosisResult | undefined {
  const presentation = LOCAL_PRESENTATION[input.id];
  if (!presentation) {
    return undefined;
  }
  const interactions = input.answers.map((answer: DiagnosisResultAnswer) => ({
    kind: "answer" as const,
    diagnosisQuestionId: answer.diagnosisQuestionId,
    questionId: answer.questionId,
    questionVersion: answer.questionVersion,
    choiceId: answer.choiceId,
    // スコアはChoice IDを使うため方向は計算に影響しません。
    direction: "right" as const,
    acceptedAt: answer.acceptedAt,
  }));
  return {
    ...input,
    balancedLabel: presentation.balancedLabel,
    profile: presentation.score(interactions),
  };
}
