import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import {
  AnswerConflictErrorSchema,
  InvalidAnswerErrorSchema,
  InvalidRequestErrorSchema,
  SaveSurveyAnswerRequestSchema,
  SaveSurveyAnswerResponseSchema,
} from "../contract/survey/answer";
import {
  SurveyClosedErrorSchema,
  SurveyDetailResponseSchema,
  SurveyNotFoundErrorSchema,
} from "../contract/survey/detail";
import { SurveyListResponseSchema } from "../contract/survey/list";
import { saveSurveyAnswer } from "../logic/survey-answer";
import { getSurveyDetail } from "../logic/survey-detail";
import { getSurveyList } from "../logic/survey-list";
import type { AppEnv } from "../types";

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.trim().match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

/** `GET /api/surveys` — 回答進捗を含む、表示可能なアンケート一覧を返す。 */
export async function getSurveys(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getSurveyList({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: d1.client.create(c.env.DB),
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(SurveyListResponseSchema, { surveys: outcome.surveys }));
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/surveys/:surveyId` — 新規回答用の公開済みQuestion Versionを返す。 */
export async function getSurvey(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getSurveyDetail({
    surveyId: c.req.param("surveyId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: d1.client.create(c.env.DB),
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(SurveyDetailResponseSchema, outcome.survey));
    case "survey-not-found":
      return c.json(
        v.parse(SurveyNotFoundErrorSchema, {
          error: "Survey not found",
          reason: "survey_not_found",
        }),
        404,
      );
    case "survey-closed":
      return c.json(
        v.parse(SurveyClosedErrorSchema, { error: "Survey closed", reason: "survey_closed" }),
        409,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `PUT /api/surveys/:surveyId/answers/:surveyQuestionId` — 本人の初回回答を保存する。 */
export async function putSurveyAnswer(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB) {
    logger.error({ path: c.req.path }, "DB binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json(v.parse(InvalidRequestErrorSchema, { error: "Invalid request" }), 400);
  }
  const parsed = v.safeParse(SaveSurveyAnswerRequestSchema, input);
  if (!parsed.success) {
    return c.json(v.parse(InvalidRequestErrorSchema, { error: "Invalid request" }), 400);
  }

  const outcome = await saveSurveyAnswer({
    surveyId: c.req.param("surveyId") ?? "",
    surveyQuestionId: c.req.param("surveyQuestionId") ?? "",
    choiceId: parsed.output.choiceId,
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: d1.client.create(c.env.DB),
  });

  switch (outcome.type) {
    case "saved":
      return c.json(
        v.parse(SaveSurveyAnswerResponseSchema, {
          outcome: outcome.outcome,
          answer: outcome.answer,
          progress: outcome.progress,
        }),
      );
    case "survey-not-found":
      return c.json(
        v.parse(SurveyNotFoundErrorSchema, {
          error: "Survey not found",
          reason: "survey_not_found",
        }),
        404,
      );
    case "survey-closed":
      return c.json(
        v.parse(SurveyClosedErrorSchema, { error: "Survey closed", reason: "survey_closed" }),
        409,
      );
    case "survey-question-not-found":
    case "choice-not-found":
      return c.json(
        v.parse(InvalidAnswerErrorSchema, {
          error: "Invalid answer",
          reason: outcome.type.replaceAll("-", "_"),
        }),
        422,
      );
    case "answer-conflict":
      return c.json(
        v.parse(AnswerConflictErrorSchema, {
          error: "Answer already exists",
          reason: "answer_change_requires_revision",
        }),
        409,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}
