import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";
import { SurveyClosedErrorSchema, SurveyNotFoundErrorSchema } from "./detail";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

export const SaveSurveyAnswerRequestSchema = v.object({
  choiceId: NonEmptyStringSchema,
});

export const SaveSurveyAnswerResponseSchema = v.object({
  outcome: v.picklist(["created", "unchanged"]),
  answer: v.object({
    surveyQuestionId: NonEmptyStringSchema,
    questionId: NonEmptyStringSchema,
    questionVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    choiceId: NonEmptyStringSchema,
    acceptedAt: TimestampSchema,
  }),
  progress: v.object({
    responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
    answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  }),
});

export const InvalidRequestErrorSchema = v.object({ error: v.literal("Invalid request") });
export const AnswerConflictErrorSchema = v.object({
  error: v.literal("Answer already exists"),
  reason: v.literal("answer_change_requires_revision"),
});
export const InvalidAnswerErrorSchema = v.object({
  error: v.literal("Invalid answer"),
  reason: v.picklist(["survey_question_not_found", "choice_not_found"]),
});

const SaveAnswerNotFoundErrorSchema = v.union([
  AccountNotFoundErrorSchema,
  SurveyNotFoundErrorSchema,
]);
const SaveAnswerConflictErrorSchema = v.union([SurveyClosedErrorSchema, AnswerConflictErrorSchema]);

export const saveSurveyAnswerRoute = describeRoute({
  operationId: "saveSurveyAnswer",
  tags: ["Survey"],
  summary: "アンケートの1問へ初回回答を保存する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: SaveSurveyAnswerRequestSchema } },
  },
  responses: {
    200: jsonResponse("保存済み回答と現在の進捗", SaveSurveyAnswerResponseSchema),
    ...authenticatedErrors,
    400: jsonResponse("リクエストJSONが不正", InvalidRequestErrorSchema),
    404: jsonResponse(
      "対応するAccountがない、またはSurveyが公開されていない",
      SaveAnswerNotFoundErrorSchema,
    ),
    409: jsonResponse("受付終了、または回答修正が必要", SaveAnswerConflictErrorSchema),
    422: jsonResponse("Survey QuestionまたはChoiceが不正", InvalidAnswerErrorSchema),
  },
} satisfies DescribeRouteOptions);
