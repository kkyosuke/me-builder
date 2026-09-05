import * as v from "valibot";

export type ParameterBand = "low" | "balanced" | "high" | "insufficient";

export type ParameterScore = Readonly<{
  score: number | null;
  coverage: number;
  band: ParameterBand;
}>;

export type ParameterComparison = Readonly<{
  /** `desired.score - behavior.score`。正なら望みが高い側です。 */
  difference: number;
  relation: "same_band" | "desired_higher" | "behavior_higher";
}>;

export type ScoredParameter = Readonly<{
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  /** 表裏では主スコアである`desired`、独立質問では従来の集計値です。 */
  resultKind: "aggregate" | "behavior_desired";
  score: ParameterScore["score"];
  coverage: ParameterScore["coverage"];
  band: ParameterScore["band"];
  behavior: ParameterScore | null;
  comparison: ParameterComparison | null;
  relationshipRequest?: string;
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
  perspective: "aggregate" | "behavior" | "desired";
  category: "preference" | "behavior_pattern";
  statement: string;
  attributes: {
    diagnosisId: string;
    scoringConfigId: string;
    scoringVersion: number;
    parameterId: string;
    perspective?: "behavior" | "desired";
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
    diagnosisQuestionId?: string | undefined;
    questionId: string;
    questionVersion: number;
    choiceIds: readonly string[];
    backsideOfDiagnosisQuestionId?: string | null | undefined;
  }>[];
}>;

type QuestionPerspective = "aggregate" | "behavior" | "desired";

const VersionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const ChoiceScoreSchema = v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(1));
const WeightSchema = v.pipe(
  v.number(),
  v.finite(),
  v.check((weight) => weight !== 0, "weightは0にできません"),
);
const ScoreBoundarySchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100));
const RelationshipRequestsSchema = v.pipe(
  v.object({
    low: v.optional(NonEmptyStringSchema),
    balanced: v.optional(NonEmptyStringSchema),
    high: v.optional(NonEmptyStringSchema),
  }),
  v.check(
    (requests) => Object.values(requests).some((request) => request !== undefined),
    "relationshipRequestsには1件以上の文が必要です",
  ),
);

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
          relationshipRequests: v.optional(RelationshipRequestsSchema),
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

/** 永続化済みの採点設定がprojection可能な契約を満たさない場合の恒久エラー。 */
export class InvalidDiagnosisScoringConfigError extends Error {
  override readonly name = "InvalidDiagnosisScoringConfigError";

  constructor(cause: unknown) {
    super("診断の採点設定が不正です", { cause });
  }
}

const DiagnosisQuestionScoringSchema = v.pipe(
  v.object({
    questions: v.pipe(
      v.array(
        v.object({
          diagnosisQuestionId: v.optional(NonEmptyStringSchema),
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
          backsideOfDiagnosisQuestionId: v.optional(v.nullable(NonEmptyStringSchema)),
        }),
      ),
      v.check(
        (questions) =>
          new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
        "question idが重複しています",
      ),
      v.check((questions) => {
        const ids = questions.flatMap(({ diagnosisQuestionId }) =>
          diagnosisQuestionId ? [diagnosisQuestionId] : [],
        );
        return new Set(ids).size === ids.length;
      }, "diagnosis question idが重複しています"),
      v.check(
        (questions) =>
          questions.every((question, index) => {
            if (!question.backsideOfDiagnosisQuestionId) return true;
            return (
              question.diagnosisQuestionId !== undefined &&
              questions[index - 1]?.diagnosisQuestionId === question.backsideOfDiagnosisQuestionId
            );
          }),
        "裏面は直前の表面Diagnosis Questionを参照してください",
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
  v.check(({ questions, config }) => {
    for (const [index, question] of questions.entries()) {
      if (!question.backsideOfDiagnosisQuestionId) continue;
      const front = questions[index - 1];
      if (!front) return false;
      const frontWeights = config.questions[front.questionId]?.weights;
      const desiredWeights = config.questions[question.questionId]?.weights;
      if (!frontWeights || !desiredWeights) return false;
      const parameterIds = new Set([...Object.keys(frontWeights), ...Object.keys(desiredWeights)]);
      if (
        [...parameterIds].some(
          (parameterId) => frontWeights[parameterId] !== desiredWeights[parameterId],
        )
      ) {
        return false;
      }
    }
    return true;
  }, "表裏質問は同じParameterへ同じ重みで寄与させてください"),
  v.check(({ questions, config }) => {
    const referencedFrontIds = new Set(
      questions.flatMap(({ backsideOfDiagnosisQuestionId }) =>
        backsideOfDiagnosisQuestionId ? [backsideOfDiagnosisQuestionId] : [],
      ),
    );
    const perspectives = new Map<string, QuestionPerspective>();
    for (const question of questions) {
      perspectives.set(
        question.questionId,
        question.backsideOfDiagnosisQuestionId
          ? "desired"
          : question.diagnosisQuestionId && referencedFrontIds.has(question.diagnosisQuestionId)
            ? "behavior"
            : "aggregate",
      );
    }
    return config.parameters.every((parameter) => {
      const contributing = new Set(
        Object.entries(config.questions).flatMap(([questionId, rule]) =>
          rule.weights[parameter.id] === undefined ? [] : [perspectives.get(questionId)],
        ),
      );
      return !(
        contributing.has("aggregate") &&
        (contributing.has("behavior") || contributing.has("desired"))
      );
    });
  }, "1つのParameterへ独立質問と表裏質問を混在させることはできません"),
);

function resolveBand(score: number | null, config: ScoringConfig): ParameterBand {
  if (score === null) return "insufficient";
  if (score <= config.lowMaximum) return "low";
  if (score >= config.highMinimum) return "high";
  return "balanced";
}

function resolveQuestionPerspectives(
  questions: StoredScoringConfig["questions"],
): Map<string, QuestionPerspective> {
  const referencedFrontIds = new Set(
    questions.flatMap(({ backsideOfDiagnosisQuestionId }) =>
      backsideOfDiagnosisQuestionId ? [backsideOfDiagnosisQuestionId] : [],
    ),
  );
  return new Map(
    questions.map((question) => [
      question.questionId,
      question.backsideOfDiagnosisQuestionId
        ? "desired"
        : question.diagnosisQuestionId && referencedFrontIds.has(question.diagnosisQuestionId)
          ? "behavior"
          : "aggregate",
    ]),
  );
}

function scoreParameter(
  parameterId: string,
  answers: ReadonlyMap<string, ScoringAnswer>,
  config: ScoringConfig,
  maximumChoiceMagnitude: number,
  perspectives: ReadonlyMap<string, QuestionPerspective>,
  includedPerspective: QuestionPerspective,
): ParameterScore {
  let totalWeight = 0;
  let answeredWeight = 0;
  let weightedSum = 0;

  for (const [questionId, rule] of Object.entries(config.questions)) {
    const weight = rule.weights[parameterId];
    if (weight === undefined || perspectives.get(questionId) !== includedPerspective) continue;

    const comparableWeight = Math.abs(weight) * maximumChoiceMagnitude;
    totalWeight += comparableWeight;
    const answer = answers.get(questionId);
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
    score,
    coverage: Math.round(coverage * 100),
    band: resolveBand(score, config),
  };
}

function compareParameterScores(
  behavior: ParameterScore,
  desired: ParameterScore,
): ParameterComparison | null {
  if (behavior.score === null || desired.score === null) return null;
  const difference = desired.score - behavior.score;
  return {
    difference,
    relation:
      behavior.band === desired.band
        ? "same_band"
        : difference > 0
          ? "desired_higher"
          : "behavior_higher",
  };
}

function scoreParameters(
  answers: readonly ScoringAnswer[],
  config: ScoringConfig,
  perspectives: ReadonlyMap<string, QuestionPerspective>,
): DiagnosisScoring {
  const currentAnswers = new Map(answers.map((answer) => [answer.questionId, answer]));
  const maximumChoiceMagnitude = Math.max(...Object.values(config.choiceScores).map(Math.abs));

  const parameters = config.parameters.map((parameter): ScoredParameter => {
    const isBehaviorDesired = Object.entries(config.questions).some(
      ([questionId, rule]) =>
        rule.weights[parameter.id] !== undefined && perspectives.get(questionId) === "behavior",
    );
    const desiredOrAggregate = scoreParameter(
      parameter.id,
      currentAnswers,
      config,
      maximumChoiceMagnitude,
      perspectives,
      isBehaviorDesired ? "desired" : "aggregate",
    );
    const behavior = isBehaviorDesired
      ? scoreParameter(
          parameter.id,
          currentAnswers,
          config,
          maximumChoiceMagnitude,
          perspectives,
          "behavior",
        )
      : null;
    const { relationshipRequests, ...displayParameter } = parameter;
    const relationshipRequest =
      desiredOrAggregate.band === "insufficient"
        ? undefined
        : relationshipRequests?.[desiredOrAggregate.band];
    return {
      ...displayParameter,
      resultKind: isBehaviorDesired ? "behavior_desired" : "aggregate",
      ...desiredOrAggregate,
      behavior,
      comparison: behavior ? compareParameterScores(behavior, desiredOrAggregate) : null,
      ...(relationshipRequest ? { relationshipRequest } : {}),
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
  try {
    const config = v.parse(ScoringConfigSchema, {
      ...v.parse(v.record(v.string(), v.unknown()), storedConfig.definition),
      version: storedConfig.version,
    });
    const validated = v.parse(DiagnosisQuestionScoringSchema, {
      questions: storedConfig.questions,
      config,
    });
    return scoreParameters(answers, config, resolveQuestionPerspectives(validated.questions));
  } catch (error) {
    if (error instanceof v.ValiError) throw new InvalidDiagnosisScoringConfigError(error);
    throw error;
  }
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

  let config: ScoringConfig;
  try {
    config = v.parse(ScoringConfigSchema, {
      ...v.parse(v.record(v.string(), v.unknown()), input.storedConfig.definition),
      version: input.storedConfig.version,
    });
  } catch (error) {
    if (error instanceof v.ValiError) throw new InvalidDiagnosisScoringConfigError(error);
    throw error;
  }
  const currentAnswers = new Map(input.answers.map((answer) => [answer.questionId, answer]));
  const questionPerspectives = resolveQuestionPerspectives(input.storedConfig.questions);

  return scoring.parameters.flatMap((parameter): DiagnosisParameterProjection[] => {
    const createProjection = (
      perspective: DiagnosisParameterProjection["perspective"],
      category: DiagnosisParameterProjection["category"],
      value: ParameterScore,
    ): DiagnosisParameterProjection[] => {
      if (value.score === null || value.band === "insufficient") return [];
      const bandLabel =
        value.band === "low"
          ? parameter.lowLabel
          : value.band === "high"
            ? parameter.highLabel
            : scoring.balancedLabel;
      const evidenceSourceRecordIds = Object.entries(config.questions)
        .filter(
          ([questionId, rule]) =>
            rule.weights[parameter.id] !== undefined &&
            questionPerspectives.get(questionId) === perspective,
        )
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
        ...(perspective === "aggregate" ? {} : { perspective }),
        score: value.score,
        coverage: value.coverage,
        band: value.band,
      };
      const statement =
        perspective === "behavior"
          ? `${parameter.label}の普段の行動は「${bandLabel}」の傾向がある`
          : perspective === "desired"
            ? `${parameter.label}で大切にしたいことは「${bandLabel}」の傾向がある`
            : `${parameter.label}は「${bandLabel}」の傾向がある`;
      return [
        {
          parameterId: parameter.id,
          perspective,
          category,
          statement,
          attributes,
          evidenceSourceRecordIds,
          contentSignature: JSON.stringify({ statement, attributes }),
        },
      ];
    };

    if (parameter.resultKind === "aggregate") {
      return createProjection("aggregate", "preference", parameter);
    }
    if (!parameter.behavior) return [];
    return [
      ...createProjection("behavior", "behavior_pattern", parameter.behavior),
      ...createProjection("desired", "preference", parameter),
    ];
  });
}
