import * as v from "valibot";
import type { DiagnosisAnswer, DiagnosisInteraction, DiagnosisQuestion } from "./types";

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

/** 診断ごとに差し替える設定。計算処理はこの形だけに依存します。 */
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

const VERSION_MESSAGE = "versionは1以上の整数にしてください";
const CHOICE_SCORES_MESSAGE = "choiceScoresは-1〜1の有限な値と、0以外の値を持つ必要があります";
const SCORE_BOUNDARIES_MESSAGE = "スコア境界は0〜100の範囲でlowMaximum < highMinimumにしてください";

const VersionSchema = v.pipe(
  v.number(VERSION_MESSAGE),
  v.integer(VERSION_MESSAGE),
  v.minValue(1, VERSION_MESSAGE),
);
const ChoiceScoreSchema = v.pipe(
  v.number(CHOICE_SCORES_MESSAGE),
  v.finite(CHOICE_SCORES_MESSAGE),
  v.minValue(-1, CHOICE_SCORES_MESSAGE),
  v.maxValue(1, CHOICE_SCORES_MESSAGE),
);
const WeightSchema = v.pipe(
  v.number("weightは0以外の有限な値にしてください"),
  v.finite("weightは0以外の有限な値にしてください"),
  v.check((weight) => weight !== 0, "weightは0以外の有限な値にしてください"),
);
const ScoreBoundarySchema = v.pipe(
  v.number(SCORE_BOUNDARIES_MESSAGE),
  v.finite(SCORE_BOUNDARIES_MESSAGE),
  v.minValue(0, SCORE_BOUNDARIES_MESSAGE),
  v.maxValue(100, SCORE_BOUNDARIES_MESSAGE),
);

/** 診断固有のスコアリング設定が共通の不変条件を満たすことを検証します。 */
export const ParameterScoringConfigSchema = v.pipe(
  v.object({
    version: VersionSchema,
    parameters: v.pipe(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          lowLabel: v.string(),
          highLabel: v.string(),
        }),
      ),
      v.nonEmpty("parametersを1件以上設定してください"),
      v.check(
        (parameters) => new Set(parameters.map(({ id }) => id)).size === parameters.length,
        "parameter idが重複しています",
      ),
    ),
    choiceScores: v.pipe(
      v.record(v.string(), ChoiceScoreSchema),
      v.check(
        (choiceScores) =>
          Object.values(choiceScores).length > 0 &&
          Object.values(choiceScores).some((score) => score !== 0),
        CHOICE_SCORES_MESSAGE,
      ),
    ),
    questions: v.record(
      v.string(),
      v.object({
        questionVersion: VersionSchema,
        weights: v.record(v.string(), WeightSchema),
      }),
    ),
    minimumCoverage: v.pipe(
      v.number("minimumCoverageは0〜1にしてください"),
      v.finite("minimumCoverageは0〜1にしてください"),
      v.minValue(0, "minimumCoverageは0〜1にしてください"),
      v.maxValue(1, "minimumCoverageは0〜1にしてください"),
    ),
    lowMaximum: ScoreBoundarySchema,
    highMinimum: ScoreBoundarySchema,
    balancedLabel: v.string(),
  }),
  v.check(({ lowMaximum, highMinimum }) => lowMaximum < highMinimum, SCORE_BOUNDARIES_MESSAGE),
  v.check(({ parameters, questions }) => {
    const parameterIds = new Set(parameters.map(({ id }) => id));
    return Object.values(questions).every(({ weights }) =>
      Object.keys(weights).every((parameterId) => parameterIds.has(parameterId)),
    );
  }, "questionsのweightsに未知のparameter idがあります"),
  v.check(({ parameters, questions }) => {
    const weightedParameterIds = new Set(
      Object.values(questions).flatMap(({ weights }) => Object.keys(weights)),
    );
    return parameters.every(({ id }) => weightedParameterIds.has(id));
  }, "質問の重みがないparameter idがあります"),
);

const DiagnosisQuestionScoringSchema = v.pipe(
  v.object({
    questions: v.pipe(
      v.array(
        v.object({
          questionId: v.string(),
          questionVersion: VersionSchema,
          left: v.object({ choiceId: v.string() }),
          right: v.object({ choiceId: v.string() }),
        }),
      ),
      v.check(
        (questions) =>
          new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
        "question idが重複しています",
      ),
      v.check(
        (questions) => questions.every(({ left, right }) => left.choiceId !== right.choiceId),
        "同じ質問の選択値は重複できません",
      ),
    ),
    config: ParameterScoringConfigSchema,
  }),
  v.check(({ questions, config }) => {
    const questionIds = new Set(questions.map(({ questionId }) => questionId));
    const configuredQuestionIds = Object.keys(config.questions);
    return (
      questionIds.size === configuredQuestionIds.length &&
      configuredQuestionIds.every((questionId) => questionIds.has(questionId))
    );
  }, "質問定義とスコアリング設定のQuestion IDが一致しません"),
  v.check(({ questions, config }) => {
    const questionVersions = new Map(
      questions.map(({ questionId, questionVersion }) => [questionId, questionVersion]),
    );
    return Object.entries(config.questions).every(
      ([questionId, rule]) => questionVersions.get(questionId) === rule.questionVersion,
    );
  }, "質問定義とスコアリング設定のQuestion Versionが一致しません"),
  v.check(
    ({ questions, config }) =>
      questions.every(
        ({ left, right }) =>
          left.choiceId in config.choiceScores && right.choiceId in config.choiceScores,
      ),
    "質問の選択値がchoiceScoresに定義されていません",
  ),
);

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
 * 質問定義、設定、現在の回答から、診断に依存しない同じ手順でパラメータを計算します。
 * 未知の質問・選択肢、延期、設定と異なる質問版は計算へ含めません。
 */
export function scoreParameters<ParameterId extends string>(
  interactions: DiagnosisInteraction[],
  questions: readonly DiagnosisQuestion[],
  config: ParameterScoringConfig<ParameterId>,
): ParameterProfile<ParameterId> {
  v.parse(DiagnosisQuestionScoringSchema, { questions, config });

  // DiagnosisResponseと同じく、同じ質問への再回答では最後の回答を現在値として扱います。
  const currentAnswers = new Map(
    interactions
      .filter((interaction): interaction is DiagnosisAnswer => interaction.kind === "answer")
      .map((answer) => [answer.questionId, answer]),
  );
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
      if (!answer || answer.questionVersion !== rule.questionVersion) {
        continue;
      }
      const choiceScore = config.choiceScores[answer.choiceId];
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
