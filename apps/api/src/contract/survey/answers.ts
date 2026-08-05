import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

const SurveyAnswerSchema = v.object({
  surveyQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  questionText: NonEmptyStringSchema,
  choiceId: NonEmptyStringSchema,
  choiceLabel: NonEmptyStringSchema,
  acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const SurveyAnswersResponseSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  responseStatus: v.picklist(["in-progress", "answered"]),
  answeredCount: CountSchema,
  questionCount: v.pipe(CountSchema, v.minValue(1)),
  answers: v.pipe(v.array(SurveyAnswerSchema), v.minLength(1)),
});

export const SurveyAnswersNotFoundErrorSchema = v.object({
  error: v.literal("Survey answers not found"),
  reason: v.literal("survey_answers_not_found"),
});

const NotFoundSchema = v.union([AccountNotFoundErrorSchema, SurveyAnswersNotFoundErrorSchema]);

export const surveyAnswersRoute = describeRoute({
  operationId: "getSurveyAnswers",
  tags: ["Survey"],
  summary: "本人が保存したアンケート回答内容を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("質問文・選択肢・回答日時を含む本人の回答内容", SurveyAnswersResponseSchema),
    ...authenticatedErrors,
    404: jsonResponse("対応するAccount、Survey、または回答がない", NotFoundSchema),
  },
} satisfies DescribeRouteOptions);
