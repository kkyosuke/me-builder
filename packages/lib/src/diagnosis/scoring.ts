import * as v from "valibot";

export type ParameterBand = "low" | "balanced" | "high" | "insufficient";

export type ScoredParameter = Readonly<{
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

export type ScoringAnswer = Readonly<{
  questionId: string;
  questionVersion: number;
  choiceId: string;
}>;

export type ProjectionScoringAnswer = ScoringAnswer &
  Readonly<{
    sourceRecordId: string;
  }>;

export type DiagnosisParameterProjection = Readonly<{
  parameterId: string;
  statement: string;
  attributes: {
    diagnosisId: string;
    scoringConfigId: string;
    scoringVersion: number;
    parameterId: string;
    score: number;
    coverage: number;
    band: Exclude<ParameterBand, "insufficient">;
  };
  evidenceSourceRecordIds: string[];
  contentSignature: string;
}>;

export type StoredScoringConfig = Readonly<{
  version: number;
  definition: unknown;
  questions: readonly Readonly<{
    questionId: string;
    questionVersion: number;
    choiceIds: readonly string[];
  }>[];
}>;

const VersionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const ChoiceScoreSchema = v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(1));
const WeightSchema = v.pipe(
  v.number(),
  v.finite(),
  v.check((weight) => weight !== 0, "weightは0にできません"),
);
const ScoreBoundarySchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100));

const ScoringConfigSchema = v.pipe(
  v.object({
    version: VersionSchema,
    parameters: v.pipe(
      v.array(
        v.object({
          id: NonEmptyStringSchema,
          label: NonEmptyStringSchema,
          lowLabel: NonEmptyStringSchema,
          highLabel: NonEmptyStringSchema,
        }),
      ),
      v.minLength(1),
      v.check(
        (parameters) => new Set(parameters.map(({ id }) => id)).size === parameters.length,
        "parameter idが重複しています",
      ),
    ),
    choiceScores: v.pipe(
      v.record(NonEmptyStringSchema, ChoiceScoreSchema),
      v.check(
        (choiceScores) =>
          Object.values(choiceScores).length > 0 &&
          Object.values(choiceScores).some((score) => score !== 0),
        "choiceScoresには0以外の値が必要です",
      ),
    ),
    questions: v.record(
      NonEmptyStringSchema,
      v.object({
        questionVersion: VersionSchema,
        weights: v.record(NonEmptyStringSchema, WeightSchema),
      }),
    ),
    minimumCoverage: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
    lowMaximum: ScoreBoundarySchema,
    highMinimum: ScoreBoundarySchema,
    balancedLabel: NonEmptyStringSchema,
  }),
  v.check(
    ({ lowMaximum, highMinimum }) => lowMaximum < highMinimum,
    "lowMaximumはhighMinimum未満にしてください",
  ),
  v.check(({ parameters, questions }) => {
    const parameterIds = new Set(parameters.map(({ id }) => id));
    return Object.values(questions).every(({ weights }) =>
      Object.keys(weights).every((parameterId) => parameterIds.has(parameterId)),
    );
  }, "questionsが未知のparameter idを参照しています"),
  v.check(({ parameters, questions }) => {
    const weightedParameterIds = new Set(
      Object.values(questions).flatMap(({ weights }) => Object.keys(weights)),
    );
    return parameters.every(({ id }) => weightedParameterIds.has(id));
  }, "重みが設定されていないparameterがあります"),
);

type ScoringConfig = v.InferOutput<typeof ScoringConfigSchema>;

const DiagnosisQuestionScoringSchema = v.pipe(
  v.object({
    questions: v.pipe(
      v.array(
        v.object({
          questionId: NonEmptyStringSchema,
          questionVersion: VersionSchema,
          choiceIds: v.pipe(
            v.array(NonEmptyStringSchema),
            v.minLength(1),
            v.check(
              (choiceIds) => new Set(choiceIds).size === choiceIds.length,
              "同じ質問のchoice idが重複しています",
            ),
          ),
        }),
      ),
      v.check(
        (questions) =>
          new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
        "question idが重複しています",
      ),
    ),
    config: ScoringConfigSchema,
  }),
  v.check(({ questions, config }) => {
    const questionIds = new Set(questions.map(({ questionId }) => questionId));
    const configuredQuestionIds = Object.keys(config.questions);
    return (
      questionIds.size === configuredQuestionIds.length &&
      configuredQuestionIds.every((questionId) => questionIds.has(questionId))
    );
  }, "質問定義と採点設定のQuestion IDが一致しません"),
  v.check(({ questions, config }) => {
    const questionVersions = new Map(
      questions.map(({ questionId, questionVersion }) => [questionId, questionVersion]),
    );
    return Object.entries(config.questions).every(
      ([questionId, rule]) => questionVersions.get(questionId) === rule.questionVersion,
    );
  }, "質問定義と採点設定のQuestion Versionが一致しません"),
  v.check(
    ({ questions, config }) =>
      questions.every(({ choiceIds }) =>
        choiceIds.every((choiceId) => Object.hasOwn(config.choiceScores, choiceId)),
      ),
    "質問の選択値がchoiceScoresに定義されていません",
  ),
);

function resolveBand(score: number | null, config: ScoringConfig): ParameterBand {
  if (score === null) return "insufficient";
  if (score <= config.lowMaximum) return "low";
  if (score >= config.highMinimum) return "high";
  return "balanced";
}

function scoreParameters(
  answers: readonly ScoringAnswer[],
  config: ScoringConfig,
): DiagnosisScoring {
  const currentAnswers = new Map(answers.map((answer) => [answer.questionId, answer]));
  const maximumChoiceMagnitude = Math.max(...Object.values(config.choiceScores).map(Math.abs));

  const parameters = config.parameters.map((parameter): ScoredParameter => {
    let totalWeight = 0;
    let answeredWeight = 0;
    let weightedSum = 0;

    for (const [questionId, rule] of Object.entries(config.questions)) {
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

/** Diagnosisが参照するDB上の版付き設定から、保存済み回答の傾向を計算します。 */
export function scoreDiagnosisAnswers(
  answers: readonly ScoringAnswer[],
  storedConfig: StoredScoringConfig | null,
): DiagnosisScoring | null {
  if (!storedConfig) return null;
  const config = v.parse(ScoringConfigSchema, {
    ...v.parse(v.record(v.string(), v.unknown()), storedConfig.definition),
    version: storedConfig.version,
  });
  v.parse(DiagnosisQuestionScoringSchema, { questions: storedConfig.questions, config });
  return scoreParameters(answers, config);
}

/** 完了した診断のParameter ProfileをEvidence付きBrain Item入力へ変換します。 */
export function projectDiagnosisParameters(input: {
  diagnosisId: string;
  scoringConfigId: string;
  answers: readonly ProjectionScoringAnswer[];
  storedConfig: StoredScoringConfig;
}): DiagnosisParameterProjection[] {
  const scoring = scoreDiagnosisAnswers(input.answers, input.storedConfig);
  if (!scoring) return [];

  const config = v.parse(ScoringConfigSchema, {
    ...v.parse(v.record(v.string(), v.unknown()), input.storedConfig.definition),
    version: input.storedConfig.version,
  });
  const currentAnswers = new Map(input.answers.map((answer) => [answer.questionId, answer]));

  return scoring.parameters.flatMap((parameter): DiagnosisParameterProjection[] => {
    if (parameter.score === null || parameter.band === "insufficient") return [];
    const bandLabel =
      parameter.band === "low"
        ? parameter.lowLabel
        : parameter.band === "high"
          ? parameter.highLabel
          : scoring.balancedLabel;
    const evidenceSourceRecordIds = Object.entries(config.questions)
      .filter(([, rule]) => rule.weights[parameter.id] !== undefined)
      .flatMap(([questionId, rule]) => {
        const answer = currentAnswers.get(questionId);
        return answer?.questionVersion === rule.questionVersion ? [answer.sourceRecordId] : [];
      })
      .sort();
    if (evidenceSourceRecordIds.length === 0) return [];

    const attributes = {
      diagnosisId: input.diagnosisId,
      scoringConfigId: input.scoringConfigId,
      scoringVersion: scoring.scoringVersion,
      parameterId: parameter.id,
      score: parameter.score,
      coverage: parameter.coverage,
      band: parameter.band,
    };
    const statement = `${parameter.label}は「${bandLabel}」の傾向がある`;
    return [
      {
        parameterId: parameter.id,
        statement,
        attributes,
        evidenceSourceRecordIds,
        contentSignature: JSON.stringify({ statement, attributes, evidenceSourceRecordIds }),
      },
    ];
  });
}
