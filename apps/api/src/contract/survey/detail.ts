import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

const SurveyChoiceSchema = v.object({
  choiceId: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  presentation: v.record(v.string(), v.string()),
});

const SurveyQuestionSchema = v.object({
  surveyQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  text: NonEmptyStringSchema,
  hint: v.nullable(NonEmptyStringSchema),
  choices: v.pipe(v.array(SurveyChoiceSchema), v.minLength(2)),
});

export const SurveyDetailResponseSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  opensAt: TimestampSchema,
  closesAt: v.nullable(TimestampSchema),
  questions: v.pipe(v.array(SurveyQuestionSchema), v.minLength(1)),
});

export const SurveyNotFoundErrorSchema = v.object({
  error: v.literal("Survey not found"),
  reason: v.literal("survey_not_found"),
});

export const SurveyClosedErrorSchema = v.object({
  error: v.literal("Survey closed"),
  reason: v.literal("survey_closed"),
});

const SurveyDetailNotFoundErrorSchema = v.union([
  AccountNotFoundErrorSchema,
  SurveyNotFoundErrorSchema,
]);

export const surveyDetailRoute = describeRoute({
  operationId: "getSurveyDetail",
  tags: ["Survey"],
  summary: "新規回答用のアンケート詳細を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("Question VersionとChoiceを含むアンケート詳細", SurveyDetailResponseSchema),
    ...authenticatedErrors,
    404: jsonResponse(
      "対応するAccountがない、またはSurveyが公開されていない",
      SurveyDetailNotFoundErrorSchema,
    ),
    409: jsonResponse("Surveyの受付が終了している", SurveyClosedErrorSchema),
  },
} satisfies DescribeRouteOptions);
