import {
  type ParameterProfile,
  type ParameterScoringConfig,
  scoreParameters,
} from "../parameter-scoring";
import type { SurveyInteraction, SurveyQuestion } from "../types";

const RELATIONSHIP_PRIORITY_SCORING_VERSION = 1;

type ParameterId = "priority-balance" | "autonomy" | "boundary-expression" | "support-flexibility";

export type RelationshipPriorityProfile = ParameterProfile<ParameterId>;

const NO_CHOICE = { choiceId: "no", label: "いいえ", icon: "circle-x" } as const;
const YES_CHOICE = { choiceId: "yes", label: "はい", icon: "circle-check" } as const;

/** 最初に公開する「自分と相手の優先・境界線」10問のversion 1。 */
export const RELATIONSHIP_PRIORITY_QUESTIONS: SurveyQuestion[] = [
  {
    surveyQuestionId: "sq-relationship-priority-01",
    questionId: "q-relationship-priority-01",
    questionVersion: 1,
    text: "相手から頼まれても、自分に余裕がなければ断りたい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-02",
    questionId: "q-relationship-priority-02",
    questionVersion: 1,
    text: "自分の予定より、相手が困っていることを優先したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-03",
    questionId: "q-relationship-priority-03",
    questionVersion: 1,
    text: "相手に合わせるために、自分の希望を変えることが多い。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-04",
    questionId: "q-relationship-priority-04",
    questionVersion: 1,
    text: "断るときは、詳しい理由を説明するべきだと思う。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-05",
    questionId: "q-relationship-priority-05",
    questionVersion: 1,
    text: "相手が一人で決めたことでも、本人の選択として尊重できる。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-06",
    questionId: "q-relationship-priority-06",
    questionVersion: 1,
    text: "大切な決断は、自分に関することでも相手へ相談したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-07",
    questionId: "q-relationship-priority-07",
    questionVersion: 1,
    text: "自分が我慢すれば済むことは、相手に言わずに我慢しやすい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-08",
    questionId: "q-relationship-priority-08",
    questionVersion: 1,
    text: "相手の機嫌が悪くても、自分の責任だとは限らないと思える。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-09",
    questionId: "q-relationship-priority-09",
    questionVersion: 1,
    text: "相手を支えるためなら、一時的に自分の予定を減らしてもよい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-relationship-priority-10",
    questionId: "q-relationship-priority-10",
    questionVersion: 1,
    text: "相手の期待に応えられないときでも、自分を優先してよいと思う。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
];

export const RELATIONSHIP_PRIORITY_SCORING_CONFIG = {
  version: RELATIONSHIP_PRIORITY_SCORING_VERSION,
  choiceScores: { yes: 1, no: -1 },
  parameters: [
    {
      id: "priority-balance",
      label: "自分／相手の優先",
      lowLabel: "相手を優先しやすい",
      highLabel: "自分の余裕を優先しやすい",
    },
    {
      id: "autonomy",
      label: "自律／相談",
      lowLabel: "相談・共有を重視",
      highLabel: "個人の判断を尊重",
    },
    {
      id: "boundary-expression",
      label: "境界の表明",
      lowLabel: "内側で調整しやすい",
      highLabel: "境界を伝えやすい",
    },
    {
      id: "support-flexibility",
      label: "支援の柔軟性",
      lowLabel: "自分の予定を守りやすい",
      highLabel: "相手のために調整しやすい",
    },
  ],
  questions: {
    "q-relationship-priority-01": {
      questionVersion: 1,
      weights: { "priority-balance": 1, "boundary-expression": 1 },
    },
    "q-relationship-priority-02": {
      questionVersion: 1,
      weights: { "priority-balance": -1, "support-flexibility": 1 },
    },
    "q-relationship-priority-03": {
      questionVersion: 1,
      weights: { "priority-balance": -1, "boundary-expression": -1 },
    },
    "q-relationship-priority-04": { questionVersion: 1, weights: { autonomy: -1 } },
    "q-relationship-priority-05": { questionVersion: 1, weights: { autonomy: 1 } },
    "q-relationship-priority-06": { questionVersion: 1, weights: { autonomy: -1 } },
    "q-relationship-priority-07": {
      questionVersion: 1,
      weights: { "priority-balance": -1, "boundary-expression": -1 },
    },
    "q-relationship-priority-08": {
      questionVersion: 1,
      weights: { autonomy: 1, "boundary-expression": 1 },
    },
    "q-relationship-priority-09": {
      questionVersion: 1,
      weights: { "priority-balance": -1, "support-flexibility": 1 },
    },
    "q-relationship-priority-10": {
      questionVersion: 1,
      weights: {
        "priority-balance": 1,
        autonomy: 0.5,
        "boundary-expression": 1,
        "support-flexibility": -1,
      },
    },
  },
  minimumCoverage: 0.6,
  lowMaximum: 35,
  highMinimum: 65,
  balancedLabel: "状況に応じて調整",
} as const satisfies ParameterScoringConfig<ParameterId>;

/**
 * 10問の回答を、版管理された決定的な重み付き変換で4パラメータへ変換します。
 * 未知の質問、延期、version 1以外の回答は計算へ含めません。
 */
export function scoreRelationshipPriority(
  interactions: SurveyInteraction[],
): RelationshipPriorityProfile {
  return scoreParameters(
    interactions,
    RELATIONSHIP_PRIORITY_QUESTIONS,
    RELATIONSHIP_PRIORITY_SCORING_CONFIG,
  );
}
