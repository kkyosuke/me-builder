import type { SurveyAnswer } from "./types";

type ParameterBand = "low" | "balanced" | "high" | "insufficient";

interface ParameterDefinition<ParameterId extends string> {
  id: ParameterId;
  label: string;
  lowLabel: string;
  highLabel: string;
}

interface QuestionScoringRule<ParameterId extends string> {
  questionVersion: number;
  /** 正なら選択値の正方向、負なら負方向へパラメータを動かします。 */
  weights: Partial<Record<ParameterId, number>>;
}

/** アンケートごとに差し替える設定。計算処理はこの形だけに依存します。 */
export interface ParameterScoringConfig<ParameterId extends string> {
  version: number;
  parameters: readonly ParameterDefinition<ParameterId>[];
  /** 回答値を-1〜1の範囲へ変換します。Yes／No以外の選択肢にも対応できます。 */
  choiceScores: Readonly<Record<string, number>>;
  questions: Readonly<Record<string, QuestionScoringRule<ParameterId>>>;
  minimumCoverage: number;
  lowMaximum: number;
  highMinimum: number;
  balancedLabel: string;
}

export interface ScoredParameter<ParameterId extends string>
  extends ParameterDefinition<ParameterId> {
  /** 回答不足の場合は断定を避けるためnullにします。 */
  score: number | null;
  /** この軸に割り当てた重みのうち、回答済みの割合。統計的な確信度ではありません。 */
  coverage: number;
  band: ParameterBand;
}

export interface ParameterProfile<ParameterId extends string> {
  scoringVersion: number;
  parameters: ScoredParameter<ParameterId>[];
}

function validateConfig<ParameterId extends string>(
  config: ParameterScoringConfig<ParameterId>,
): void {
  if (!Number.isInteger(config.version) || config.version < 1) {
    throw new Error("scoring versionは1以上の整数にしてください");
  }
  if (
    !Number.isFinite(config.minimumCoverage) ||
    config.minimumCoverage < 0 ||
    config.minimumCoverage > 1
  ) {
    throw new Error("minimumCoverageは0〜1にしてください");
  }
  if (
    !Number.isFinite(config.lowMaximum) ||
    !Number.isFinite(config.highMinimum) ||
    config.lowMaximum < 0 ||
    config.highMinimum > 100 ||
    config.lowMaximum >= config.highMinimum
  ) {
    throw new Error("スコア境界は0〜100の範囲でlowMaximum < highMinimumにしてください");
  }
  const parameterIds = config.parameters.map(({ id }) => id);
  if (parameterIds.length === 0) {
    throw new Error("parametersを1件以上設定してください");
  }
  if (new Set(parameterIds).size !== parameterIds.length) {
    throw new Error("parameter idが重複しています");
  }
  const choiceScoreValues = Object.values(config.choiceScores);
  if (
    choiceScoreValues.length === 0 ||
    Math.max(...choiceScoreValues.map(Math.abs)) === 0 ||
    choiceScoreValues.some((score) => !Number.isFinite(score) || score < -1 || score > 1)
  ) {
    throw new Error("choiceScoresは-1〜1の有限な値と、0以外の値を持つ必要があります");
  }

  const knownParameterIds = new Set<string>(parameterIds);
  const weightedParameterIds = new Set<string>();
  for (const { questionVersion, weights } of Object.values(config.questions)) {
    if (!Number.isInteger(questionVersion) || questionVersion < 1) {
      throw new Error("questionVersionは1以上の整数にしてください");
    }
    for (const [parameterId, weight] of Object.entries(weights)) {
      if (!knownParameterIds.has(parameterId)) {
        throw new Error(`未知のparameter idです: ${parameterId}`);
      }
      if (!Number.isFinite(weight) || weight === 0) {
        throw new Error("weightは0以外の有限な値にしてください");
      }
      weightedParameterIds.add(parameterId);
    }
  }
  const unweightedParameterId = parameterIds.find((id) => !weightedParameterIds.has(id));
  if (unweightedParameterId) {
    throw new Error(`質問の重みがないparameter idです: ${unweightedParameterId}`);
  }
}

function resolveBand<ParameterId extends string>(
  score: number | null,
  config: ParameterScoringConfig<ParameterId>,
): ParameterBand {
  if (score === null) {
    return "insufficient";
  }
  if (score <= config.lowMaximum) {
    return "low";
  }
  if (score >= config.highMinimum) {
    return "high";
  }
  return "balanced";
}

/**
 * 設定と現在の回答から、アンケートに依存しない同じ手順でパラメータを計算します。
 * 未知の質問・選択肢、スキップ、設定と異なる質問版は計算へ含めません。
 */
export function scoreParameters<ParameterId extends string>(
  answers: SurveyAnswer[],
  config: ParameterScoringConfig<ParameterId>,
): ParameterProfile<ParameterId> {
  validateConfig(config);

  // SurveyResponseと同じく、同じ質問への再回答では最後の回答を現在値として扱います。
  const currentAnswers = new Map(answers.map((answer) => [answer.questionId, answer]));
  const maximumChoiceMagnitude = Math.max(...Object.values(config.choiceScores).map(Math.abs));

  const parameters = config.parameters.map((parameter): ScoredParameter<ParameterId> => {
    let totalWeight = 0;
    let answeredWeight = 0;
    let weightedSum = 0;

    for (const [questionId, rule] of Object.entries(config.questions) as [
      string,
      QuestionScoringRule<ParameterId>,
    ][]) {
      const weight = rule.weights[parameter.id];
      if (weight === undefined) {
        continue;
      }
      const comparableWeight = Math.abs(weight) * maximumChoiceMagnitude;
      totalWeight += comparableWeight;

      const answer = currentAnswers.get(questionId);
      if (!answer || answer.kind !== "choice" || answer.questionVersion !== rule.questionVersion) {
        continue;
      }
      const choiceScore = config.choiceScores[answer.value];
      if (choiceScore === undefined) {
        continue;
      }
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

  return { scoringVersion: config.version, parameters };
}

export function getParameterSummary<ParameterId extends string>(
  parameter: ScoredParameter<ParameterId>,
  balancedLabel: string,
): string {
  switch (parameter.band) {
    case "low":
      return parameter.lowLabel;
    case "high":
      return parameter.highLabel;
    case "balanced":
      return balancedLabel;
    case "insufficient":
      return "回答不足";
  }
}
