import {
  MONEY_VALUES_QUESTIONS,
  MONEY_VALUES_SCORING_CONFIG,
  scoreMoneyValues,
} from "./definitions/money-values";
import { RELATIONSHIP_PRIORITY_QUESTIONS } from "./definitions/relationship-priority";
import {
  RELATIONSHIP_PRIORITY_SCORING_CONFIG,
  scoreRelationshipPriority,
} from "./definitions/relationship-priority";
import type { ParameterProfile } from "./parameter-scoring";
import type { SurveyInteraction, SurveyQuestion } from "./types";

export interface SurveyDefinition {
  id: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
  balancedLabel: string;
  score: (interactions: SurveyInteraction[]) => ParameterProfile<string>;
}

const SURVEY_DEFINITIONS: SurveyDefinition[] = [
  {
    id: "relationship-priority",
    title: "自分と相手の優先・境界線",
    description: "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
    questions: RELATIONSHIP_PRIORITY_QUESTIONS,
    balancedLabel: RELATIONSHIP_PRIORITY_SCORING_CONFIG.balancedLabel,
    score: scoreRelationshipPriority,
  },
  {
    id: "money-values",
    title: "お金と消費",
    description: "貯蓄、支出、共有、公平性、リスクに関する傾向を見ます。",
    questions: MONEY_VALUES_QUESTIONS,
    balancedLabel: MONEY_VALUES_SCORING_CONFIG.balancedLabel,
    score: scoreMoneyValues,
  },
];

/**
 * 質問の取得。
 *
 * **今はフロント側の固定データを返します。** 質問配信と回答保存のサーバー実装は後続で、
 * 差し替え先をこのモジュールに閉じるため関数として切り出しています。呼び出し側は
 * 非同期の取得としてだけ扱い、固定データであることに依存しません。
 *
 * 最初のアンケートは「自分と相手の優先・境界線」の10問です。質問文と変換規則は
 * `definitions/relationship-priority.ts`にまとめ、公開済みの版を後から書き換えません。
 */
export async function fetchSurveyQuestions(): Promise<SurveyQuestion[]> {
  return RELATIONSHIP_PRIORITY_QUESTIONS;
}

/** 現在公開しているアンケート定義の一覧。 */
export async function fetchSurveyDefinitions(): Promise<SurveyDefinition[]> {
  return SURVEY_DEFINITIONS;
}
