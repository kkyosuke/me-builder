import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";
import { DiagnosisClosedErrorSchema, DiagnosisNotFoundErrorSchema } from "./detail";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

export const DeferDiagnosisQuestionResponseSchema = v.object({
  outcome: v.picklist(["created", "unchanged"]),
  deferredQuestion: v.object({
    diagnosisQuestionId: NonEmptyStringSchema,
    deferredAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
});

export const InvalidDeferredQuestionErrorSchema = v.object({
  error: v.literal("Invalid deferred question"),
  reason: v.literal("diagnosis_question_not_found"),
});

export const QuestionAlreadyAnsweredErrorSchema = v.object({
  error: v.literal("Question already answered"),
  reason: v.literal("question_already_answered"),
});

export const deferDiagnosisQuestionRoute = describeRoute({
  operationId: "deferDiagnosisQuestion",
  tags: ["Diagnosis"],
  summary: "診断の未回答の1問をあとで回答として保存する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("保存済みの延期操作", DeferDiagnosisQuestionResponseSchema),
    ...authenticatedErrors,
    404: jsonResponse(
      "対応するAccountがない、またはDiagnosisが公開されていない",
      v.union([AccountNotFoundErrorSchema, DiagnosisNotFoundErrorSchema]),
    ),
    409: jsonResponse(
      "受付終了、または対象の質問へ回答済み",
      v.union([DiagnosisClosedErrorSchema, QuestionAlreadyAnsweredErrorSchema]),
    ),
    422: jsonResponse("Diagnosis Questionが不正", InvalidDeferredQuestionErrorSchema),
  },
} satisfies DescribeRouteOptions);
