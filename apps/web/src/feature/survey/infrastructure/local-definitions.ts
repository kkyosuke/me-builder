import { MONEY_VALUES_SCORING_CONFIG, scoreMoneyValues } from "../model/definitions/money-values";
import {
  RELATIONSHIP_PRIORITY_SCORING_CONFIG,
  scoreRelationshipPriority,
} from "../model/definitions/relationship-priority";
import type { SurveyDefinition } from "../model/survey-definition";
import type { SurveyQuestion } from "../model/types";

type LocalSurveyPresentation = Pick<SurveyDefinition, "balancedLabel" | "score">;

/**
 * スコア関数と表示メタデータだけをローカルに残し、配信内容は詳細APIを正とします。
 * スコア設定を版付きでAPI配信するか、サーバーが計算結果を返す段階でこの対応表は不要になります。
 */
const LOCAL_PRESENTATION: Record<string, LocalSurveyPresentation> = {
  "relationship-priority": {
    balancedLabel: RELATIONSHIP_PRIORITY_SCORING_CONFIG.balancedLabel,
    score: scoreRelationshipPriority,
  },
  "money-values": {
    balancedLabel: MONEY_VALUES_SCORING_CONFIG.balancedLabel,
    score: scoreMoneyValues,
  },
};

export function combineSurveyDefinition(input: {
  id: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
}): SurveyDefinition | undefined {
  const presentation = LOCAL_PRESENTATION[input.id];
  return presentation ? { ...input, ...presentation } : undefined;
}
