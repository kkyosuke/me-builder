type ParameterBand = "low" | "balanced" | "high" | "insufficient";

type ScoredParameter = Readonly<{
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  score: number | null;
  coverage: number;
  band: ParameterBand;
}>;

export type DiagnosisScoring = Readonly<{
  scoringVersion: number;
  balancedLabel: string;
  parameters: ScoredParameter[];
}>;

type ScoringAnswer = Readonly<{
  questionId: string;
  questionVersion: number;
  choiceId: string;
}>;

type ParameterDefinition<ParameterId extends string> = Readonly<{
  id: ParameterId;
  label: string;
  lowLabel: string;
  highLabel: string;
}>;

type QuestionScoringRule<ParameterId extends string> = Readonly<{
  questionVersion: number;
  weights: Partial<Record<ParameterId, number>>;
}>;

type ParameterScoringConfig<ParameterId extends string> = Readonly<{
  version: number;
  parameters: readonly ParameterDefinition<ParameterId>[];
  choiceScores: Readonly<Record<string, number>>;
  questions: Readonly<Record<string, QuestionScoringRule<ParameterId>>>;
  minimumCoverage: number;
  lowMaximum: number;
  highMinimum: number;
  balancedLabel: string;
}>;

type RelationshipPriorityParameter =
  | "priority-balance"
  | "autonomy"
  | "boundary-expression"
  | "support-flexibility";

const RELATIONSHIP_PRIORITY_SCORING = {
  version: 1,
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
} as const satisfies ParameterScoringConfig<RelationshipPriorityParameter>;

type MoneyValuesParameter =
  | "future-preparation"
  | "financial-sharing"
  | "fairness-flexibility"
  | "durable-value"
  | "risk-tolerance";

const MONEY_VALUES_SCORING = {
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
} as const satisfies ParameterScoringConfig<MoneyValuesParameter>;

function assertValidScoringConfig<ParameterId extends string>(
  config: ParameterScoringConfig<ParameterId>,
): void {
  const parameterIds = config.parameters.map(({ id }) => id);
  const knownParameterIds = new Set<string>(parameterIds);
  const choiceScores = Object.values(config.choiceScores);
  const weightedParameterIds = new Set<string>();
  const validBoundary = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;

  if (!Number.isInteger(config.version) || config.version < 1) {
    throw new Error("scoring version must be a positive integer");
  }
  if (parameterIds.length === 0 || knownParameterIds.size !== parameterIds.length) {
    throw new Error("scoring parameters must have unique IDs");
  }
  if (
    choiceScores.length === 0 ||
    choiceScores.every((score) => score === 0) ||
    choiceScores.some((score) => !Number.isFinite(score) || score < -1 || score > 1)
  ) {
    throw new Error("choice scores must contain a non-zero finite value between -1 and 1");
  }
  for (const rule of Object.values(config.questions) as QuestionScoringRule<ParameterId>[]) {
    if (!Number.isInteger(rule.questionVersion) || rule.questionVersion < 1) {
      throw new Error("question version must be a positive integer");
    }
    for (const [parameterId, weight] of Object.entries(rule.weights)) {
      if (!knownParameterIds.has(parameterId)) {
        throw new Error(`unknown scoring parameter: ${parameterId}`);
      }
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight === 0) {
        throw new Error(`scoring weight must be a non-zero finite number: ${parameterId}`);
      }
      weightedParameterIds.add(parameterId);
    }
  }
  if (parameterIds.some((parameterId) => !weightedParameterIds.has(parameterId))) {
    throw new Error("every scoring parameter must have at least one weight");
  }
  if (
    !Number.isFinite(config.minimumCoverage) ||
    config.minimumCoverage < 0 ||
    config.minimumCoverage > 1
  ) {
    throw new Error("minimum coverage must be between 0 and 1");
  }
  if (
    !validBoundary(config.lowMaximum) ||
    !validBoundary(config.highMinimum) ||
    config.lowMaximum >= config.highMinimum
  ) {
    throw new Error("scoring boundaries must be ordered between 0 and 100");
  }
}

assertValidScoringConfig(RELATIONSHIP_PRIORITY_SCORING);
assertValidScoringConfig(MONEY_VALUES_SCORING);

function resolveBand<ParameterId extends string>(
  score: number | null,
  config: ParameterScoringConfig<ParameterId>,
): ParameterBand {
  if (score === null) return "insufficient";
  if (score <= config.lowMaximum) return "low";
  if (score >= config.highMinimum) return "high";
  return "balanced";
}

function scoreParameters<ParameterId extends string>(
  answers: readonly ScoringAnswer[],
  config: ParameterScoringConfig<ParameterId>,
): DiagnosisScoring {
  const currentAnswers = new Map(answers.map((answer) => [answer.questionId, answer]));
  const maximumChoiceMagnitude = Math.max(...Object.values(config.choiceScores).map(Math.abs));

  const parameters = config.parameters.map((parameter): ScoredParameter => {
    let totalWeight = 0;
    let answeredWeight = 0;
    let weightedSum = 0;

    for (const [questionId, rule] of Object.entries(config.questions) as [
      string,
      QuestionScoringRule<ParameterId>,
    ][]) {
      const weight = rule.weights[parameter.id];
      if (weight === undefined) continue;

      const comparableWeight = Math.abs(weight) * maximumChoiceMagnitude;
      totalWeight += comparableWeight;
      const answer = currentAnswers.get(questionId);
      if (!answer || answer.questionVersion !== rule.questionVersion) continue;

      const choiceScore = config.choiceScores[answer.choiceId];
      if (choiceScore === undefined) continue;
      answeredWeight += comparableWeight;
      weightedSum += choiceScore * weight;
    }

    const coverage = totalWeight === 0 ? 0 : answeredWeight / totalWeight;
    const score =
      coverage < config.minimumCoverage || answeredWeight === 0
        ? null
        : Math.round(50 + 50 * (weightedSum / answeredWeight));
    return {
      ...parameter,
      score,
      coverage: Math.round(coverage * 100),
      band: resolveBand(score, config),
    };
  });

  return {
    scoringVersion: config.version,
    balancedLabel: config.balancedLabel,
    parameters,
  };
}

/** 診断固有の採点設定をAPI内へ閉じ込め、FEへは計算済み結果だけを返します。 */
export function scoreDiagnosisAnswers(
  diagnosisId: string,
  answers: readonly ScoringAnswer[],
): DiagnosisScoring | null {
  switch (diagnosisId) {
    case "relationship-priority":
      return scoreParameters(answers, RELATIONSHIP_PRIORITY_SCORING);
    case "money-values":
      return scoreParameters(answers, MONEY_VALUES_SCORING);
    default:
      return null;
  }
}
