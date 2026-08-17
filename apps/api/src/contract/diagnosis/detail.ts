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
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

const DiagnosisChoiceSchema = v.object({
  choiceId: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
});

const DiagnosisQuestionSchema = v.object({
  diagnosisQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  text: NonEmptyStringSchema,
  hint: v.nullable(NonEmptyStringSchema),
  choices: v.pipe(v.array(DiagnosisChoiceSchema), v.length(2)),
});

export const DiagnosisDetailResponseSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  relationshipCategory: RelationshipCategorySchema,
  opensAt: TimestampSchema,
  closesAt: v.nullable(TimestampSchema),
  questions: v.pipe(v.array(DiagnosisQuestionSchema), v.minLength(1)),
});

export const DiagnosisNotFoundErrorSchema = v.object({
  error: v.literal("Diagnosis not found"),
  reason: v.literal("diagnosis_not_found"),
});

export const DiagnosisClosedErrorSchema = v.object({
  error: v.literal("Diagnosis closed"),
  reason: v.literal("diagnosis_closed"),
});

const DiagnosisDetailNotFoundErrorSchema = v.union([
  AccountNotFoundErrorSchema,
  DiagnosisNotFoundErrorSchema,
]);

export const diagnosisDetailRoute = describeRoute({
  operationId: "getDiagnosisDetail",
  tags: ["Diagnosis"],
  summary: "新規回答用の診断詳細を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("Question VersionとChoiceを含む診断詳細", DiagnosisDetailResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "対応するAccountがない、またはDiagnosisが公開されていない",
      DiagnosisDetailNotFoundErrorSchema,
    ),
    409: jsonResponse("Diagnosisの受付が終了している", DiagnosisClosedErrorSchema),
  },
} satisfies DescribeRouteOptions);
