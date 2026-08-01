import type { SurveyAnswer, SurveyQuestion } from "./types";

export const RELATIONSHIP_PRIORITY_SCORING_VERSION = 1;

type ParameterId = "priority-balance" | "autonomy" | "boundary-expression" | "support-flexibility";

interface ParameterDefinition {
  id: ParameterId;
  label: string;
  lowLabel: string;
  highLabel: string;
}

export type ParameterBand = "low" | "balanced" | "high" | "insufficient";

export interface RelationshipPriorityParameter {
  id: ParameterId;
  label: string;
  lowLabel: string;
  highLabel: string;
  /** 回答不足の場合は断定を避けるためnullにします。 */
  score: number | null;
  /** この軸に割り当てた重みのうち、回答済みの割合。統計的な確信度ではありません。 */
  coverage: number;
  band: ParameterBand;
}

export interface RelationshipPriorityProfile {
  scoringVersion: number;
  parameters: RelationshipPriorityParameter[];
}

const NO_CHOICE = { value: "no", label: "いいえ", icon: "circle-x" } as const;
const YES_CHOICE = { value: "yes", label: "はい", icon: "circle-check" } as const;

/** 最初に公開する「自分と相手の優先・境界線」10問のversion 1。 */
export const RELATIONSHIP_PRIORITY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "q-relationship-priority-01",
    version: 1,
    text: "相手から頼まれても、自分に余裕がなければ断りたい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-02",
    version: 1,
    text: "自分の予定より、相手が困っていることを優先したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-03",
    version: 1,
    text: "相手に合わせるために、自分の希望を変えることが多い。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-04",
    version: 1,
    text: "断るときは、詳しい理由を説明するべきだと思う。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-05",
    version: 1,
    text: "相手が一人で決めたことでも、本人の選択として尊重できる。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-06",
    version: 1,
    text: "大切な決断は、自分に関することでも相手へ相談したい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-07",
    version: 1,
    text: "自分が我慢すれば済むことは、相手に言わずに我慢しやすい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-08",
    version: 1,
    text: "相手の機嫌が悪くても、自分の責任だとは限らないと思える。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-09",
    version: 1,
    text: "相手を支えるためなら、一時的に自分の予定を減らしてもよい。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
  {
    id: "q-relationship-priority-10",
    version: 1,
    text: "相手の期待に応えられないときでも、自分を優先してよいと思う。",
    left: NO_CHOICE,
    right: YES_CHOICE,
  },
];

const PARAMETERS: ParameterDefinition[] = [
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
];

/** 正ならYesがパラメータの高い側、負なら低い側へ寄与します。 */
const QUESTION_WEIGHTS: Record<string, Partial<Record<ParameterId, number>>> = {
  "q-relationship-priority-01": { "priority-balance": 1, "boundary-expression": 1 },
  "q-relationship-priority-02": { "priority-balance": -1, "support-flexibility": 1 },
  "q-relationship-priority-03": { "priority-balance": -1, "boundary-expression": -1 },
  "q-relationship-priority-04": { autonomy: -1 },
  "q-relationship-priority-05": { autonomy: 1 },
  "q-relationship-priority-06": { autonomy: -1 },
  "q-relationship-priority-07": { "priority-balance": -1, "boundary-expression": -1 },
  "q-relationship-priority-08": { autonomy: 1, "boundary-expression": 1 },
  "q-relationship-priority-09": { "priority-balance": -1, "support-flexibility": 1 },
  "q-relationship-priority-10": {
    "priority-balance": 1,
    autonomy: 0.5,
    "boundary-expression": 1,
    "support-flexibility": -1,
  },
};

const MINIMUM_COVERAGE = 0.6;
const LOW_MAXIMUM = 35;
const HIGH_MINIMUM = 65;

function getBand(score: number | null): ParameterBand {
  if (score === null) {
    return "insufficient";
  }
  if (score <= LOW_MAXIMUM) {
    return "low";
  }
  if (score >= HIGH_MINIMUM) {
    return "high";
  }
  return "balanced";
}

/**
 * 10問の回答を、版管理された決定的な重み付き変換で4パラメータへ変換します。
 * 未知の質問、スキップ、version 1以外の回答は計算へ含めません。
 */
export function scoreRelationshipPriority(answers: SurveyAnswer[]): RelationshipPriorityProfile {
  const choiceAnswers = new Map(
    answers
      .filter(
        (answer) =>
          answer.kind === "choice" &&
          answer.questionVersion === 1 &&
          (answer.value === "yes" || answer.value === "no") &&
          QUESTION_WEIGHTS[answer.questionId],
      )
      .map((answer) => [answer.questionId, answer]),
  );

  const parameters = PARAMETERS.map((parameter): RelationshipPriorityParameter => {
    let totalWeight = 0;
    let answeredWeight = 0;
    let weightedSum = 0;

    for (const [questionId, weights] of Object.entries(QUESTION_WEIGHTS)) {
      const weight = weights[parameter.id];
      if (weight === undefined) {
        continue;
      }
      totalWeight += Math.abs(weight);

      const answer = choiceAnswers.get(questionId);
      if (!answer || answer.kind !== "choice") {
        continue;
      }
      answeredWeight += Math.abs(weight);
      weightedSum += (answer.value === "yes" ? 1 : -1) * weight;
    }

    const coverage = totalWeight === 0 ? 0 : answeredWeight / totalWeight;
    const score =
      coverage < MINIMUM_COVERAGE || answeredWeight === 0
        ? null
        : Math.round(50 + 50 * (weightedSum / answeredWeight));

    return {
      ...parameter,
      score,
      coverage: Math.round(coverage * 100),
      band: getBand(score),
    };
  });

  return { scoringVersion: RELATIONSHIP_PRIORITY_SCORING_VERSION, parameters };
}

export function getParameterSummary(parameter: RelationshipPriorityParameter): string {
  switch (parameter.band) {
    case "low":
      return parameter.lowLabel;
    case "high":
      return parameter.highLabel;
    case "balanced":
      return "状況に応じて調整";
    case "insufficient":
      return "回答不足";
  }
}
