import type { ParameterProfile } from "./scoring";
import type { SurveyInteraction, SurveyQuestion } from "./types";

/** 画面へ渡すアンケート定義。取得元に依存しないfeature内のモデルとして扱う。 */
export interface SurveyDefinition {
  id: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
  balancedLabel: string;
  score: (interactions: SurveyInteraction[]) => ParameterProfile<string>;
}
