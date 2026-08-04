import { type ParameterProfile, type ParameterScoringConfig, scoreParameters } from "../scoring";
import type { SurveyInteraction, SurveyQuestion } from "../types";

type ParameterId =
  | "future-preparation"
  | "financial-sharing"
  | "fairness-flexibility"
  | "durable-value"
  | "risk-tolerance";

export type MoneyValuesProfile = ParameterProfile<ParameterId>;

const NO_CHOICE = { choiceId: "no", label: "いいえ", icon: "circle-x" } as const;
const YES_CHOICE = { choiceId: "yes", label: "はい", icon: "circle-check" } as const;

/** 「お金と消費」10問のversion 1。 */
export const MONEY_VALUES_QUESTIONS: SurveyQuestion[] = [
  {
    surveyQuestionId: "sq-money-01",
    questionId: "q-money-01",
    questionVersion: 1,
    text: "収入は、今の楽しみより将来のために多く残したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-02",
    questionId: "q-money-02",
    questionVersion: 1,
    text: "欲しいもののためなら、貯金の予定を少し崩してもよい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-03",
    questionId: "q-money-03",
    questionVersion: 1,
    text: "自分のお金で高額な買い物をするときも、相手へ事前に相談したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-04",
    questionId: "q-money-04",
    questionVersion: 1,
    text: "生活費は、収入に関係なく同じ金額を負担するのが公平だと思う。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-05",
    questionId: "q-money-05",
    questionVersion: 1,
    text: "値段が高くても、長く使えるものを選びたい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-06",
    questionId: "q-money-06",
    questionVersion: 1,
    text: "記念日の贈り物には、ある程度お金をかけたい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-07",
    questionId: "q-money-07",
    questionVersion: 1,
    text: "借金やローンの状況は、交際の早い段階で共有してほしい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-08",
    questionId: "q-money-08",
    questionVersion: 1,
    text: "投資には、元本割れの可能性があっても挑戦したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-09",
    questionId: "q-money-09",
    questionVersion: 1,
    text: "家事や時間の負担が多い人は、生活費の負担が少なくてもよいと思う。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    surveyQuestionId: "sq-money-10",
    questionId: "q-money-10",
    questionVersion: 1,
    text: "家計を一緒にする場合でも、自由に使える個人のお金を残したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
];

export const MONEY_VALUES_SCORING_CONFIG = {
  version: 1,
  choiceScores: { yes: 1, no: -1 },
  parameters: [
    {
      id: "future-preparation",
      label: "将来への備え",
      lowLabel: "今の楽しみに使いやすい",
      highLabel: "将来への備えを重視",
    },
    {
      id: "financial-sharing",
      label: "お金の共有",
      lowLabel: "個人の裁量を重視",
      highLabel: "相談・情報共有を重視",
    },
    {
      id: "fairness-flexibility",
      label: "負担の公平性",
      lowLabel: "同額負担を公平と感じやすい",
      highLabel: "状況に応じた負担を重視",
    },
    {
      id: "durable-value",
      label: "支出の価値",
      lowLabel: "体験・気持ちへの支出を重視",
      highLabel: "長く使える価値を重視",
    },
    {
      id: "risk-tolerance",
      label: "リスク許容",
      lowLabel: "損失回避を重視",
      highLabel: "リスクを取れる",
    },
  ],
  questions: {
    "q-money-01": {
      questionVersion: 1,
      weights: { "future-preparation": 1, "risk-tolerance": -0.5 },
    },
    "q-money-02": {
      questionVersion: 1,
      weights: { "future-preparation": -1, "durable-value": -0.5, "risk-tolerance": 0.5 },
    },
    "q-money-03": { questionVersion: 1, weights: { "financial-sharing": 1 } },
    "q-money-04": { questionVersion: 1, weights: { "fairness-flexibility": -1 } },
    "q-money-05": {
      questionVersion: 1,
      weights: { "future-preparation": 0.5, "durable-value": 1 },
    },
    "q-money-06": {
      questionVersion: 1,
      weights: { "future-preparation": -0.5, "durable-value": -1 },
    },
    "q-money-07": { questionVersion: 1, weights: { "financial-sharing": 1 } },
    "q-money-08": { questionVersion: 1, weights: { "risk-tolerance": 1 } },
    "q-money-09": { questionVersion: 1, weights: { "fairness-flexibility": 1 } },
    "q-money-10": { questionVersion: 1, weights: { "financial-sharing": -1 } },
  },
  minimumCoverage: 0.6,
  lowMaximum: 35,
  highMinimum: 65,
  balancedLabel: "状況に応じて調整",
} as const satisfies ParameterScoringConfig<ParameterId>;

export function scoreMoneyValues(interactions: SurveyInteraction[]): MoneyValuesProfile {
  return scoreParameters(interactions, MONEY_VALUES_QUESTIONS, MONEY_VALUES_SCORING_CONFIG);
}
