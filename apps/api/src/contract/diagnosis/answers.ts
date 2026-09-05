import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";
import { RelationshipCategorySchema } from "./shared";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

const DiagnosisAnswerSchema = v.object({
  diagnosisQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  questionText: NonEmptyStringSchema,
  choiceId: NonEmptyStringSchema,
  choiceLabel: NonEmptyStringSchema,
  acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
  perspective: v.picklist(["single", "behavior", "desired"]),
  pairId: v.nullable(NonEmptyStringSchema),
});

const ParameterScoreSchema = v.object({
  score: v.nullable(v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100))),
  coverage: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  band: v.picklist(["low", "balanced", "high", "insufficient"]),
});

const ScoredParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  resultKind: v.picklist(["aggregate", "behavior_desired"]),
  ...ParameterScoreSchema.entries,
  behavior: v.nullable(ParameterScoreSchema),
  comparison: v.nullable(
    v.object({
      difference: v.pipe(v.number(), v.safeInteger(), v.minValue(-100), v.maxValue(100)),
      relation: v.picklist(["same_band", "desired_higher", "behavior_higher"]),
    }),
  ),
});

const DiagnosisScoringSchema = v.object({
  scoringVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  balancedLabel: NonEmptyStringSchema,
  parameters: v.pipe(v.array(ScoredParameterSchema), v.minLength(1)),
});

export const DiagnosisAnswersResponseSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  relationshipCategory: RelationshipCategorySchema,
  responseStatus: v.picklist(["in-progress", "answered"]),
  answeredCount: CountSchema,
  questionCount: v.pipe(CountSchema, v.minValue(1)),
  answers: v.pipe(v.array(DiagnosisAnswerSchema), v.minLength(1)),
  scoring: v.nullable(DiagnosisScoringSchema),
});

export const DiagnosisAnswersNotFoundErrorSchema = v.object({
  error: v.literal("Diagnosis answers not found"),
  reason: v.literal("diagnosis_answers_not_found"),
});

const NotFoundSchema = v.union([AccountNotFoundErrorSchema, DiagnosisAnswersNotFoundErrorSchema]);

export const diagnosisAnswersRoute = describeRoute({
  operationId: "getDiagnosisAnswers",
  tags: ["Diagnosis"],
  summary: "本人が保存した診断回答内容を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse(
      "質問文・選択肢・回答日時・計算済み傾向を含む本人の回答内容",
      DiagnosisAnswersResponseSchema,
    ),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse("対応するAccount、Diagnosis、または回答がない", NotFoundSchema),
  },
} satisfies DescribeRouteOptions);
