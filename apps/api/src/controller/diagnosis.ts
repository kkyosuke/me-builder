import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import {
  AnswerConflictErrorSchema,
  InvalidAnswerErrorSchema,
  InvalidRequestErrorSchema,
  SaveDiagnosisAnswerRequestSchema,
  SaveDiagnosisAnswerResponseSchema,
} from "../contract/diagnosis/answer";
import {
  DiagnosisAnswersNotFoundErrorSchema,
  DiagnosisAnswersResponseSchema,
} from "../contract/diagnosis/answers";
import {
  DeferDiagnosisQuestionResponseSchema,
  InvalidDeferredQuestionErrorSchema,
  QuestionAlreadyAnsweredErrorSchema,
} from "../contract/diagnosis/deferred-question";
import {
  DiagnosisClosedErrorSchema,
  DiagnosisDetailResponseSchema,
  DiagnosisNotFoundErrorSchema,
} from "../contract/diagnosis/detail";
import { DiagnosisListResponseSchema } from "../contract/diagnosis/list";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { saveDiagnosisAnswer } from "../logic/diagnosis-answer";
import { getDiagnosisAnswers } from "../logic/diagnosis-answers";
import { deferDiagnosisQuestion } from "../logic/diagnosis-deferred-question";
import { getDiagnosisDetail } from "../logic/diagnosis-detail";
import { getDiagnosisList } from "../logic/diagnosis-list";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

/** `GET /api/diagnoses` — 回答進捗を含む、表示可能な診断一覧を返す。 */
export async function getDiagnoses(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Diagnosis storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getDiagnosisList({
    actor: authenticatedActor(c),
    ...(c.env.ACCOUNT_DATA ? { accountData: c.env.ACCOUNT_DATA } : {}),
  });

  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(DiagnosisListResponseSchema, { diagnoses: outcome.diagnoses }));
  }
}

/** `GET /api/diagnoses/:diagnosisId` — 受付中または回答者向けのQuestion Versionを返す。 */
export async function getDiagnosis(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Diagnosis storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getDiagnosisDetail({
    diagnosisId: c.req.param("diagnosisId") ?? "",
    actor: authenticatedActor(c),
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(DiagnosisDetailResponseSchema, outcome.diagnosis));
    case "diagnosis-not-found":
      return c.json(
        v.parse(DiagnosisNotFoundErrorSchema, {
          error: "Diagnosis not found",
          reason: "diagnosis_not_found",
        }),
        404,
      );
    case "diagnosis-closed":
      return c.json(
        v.parse(DiagnosisClosedErrorSchema, {
          error: "Diagnosis closed",
          reason: "diagnosis_closed",
        }),
        409,
      );
  }
}

/** `PUT /api/diagnoses/:diagnosisId/answers/:diagnosisQuestionId` — 本人の初回回答を保存する。 */
export async function putDiagnosisAnswer(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Diagnosis storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json(v.parse(InvalidRequestErrorSchema, { error: "Invalid request" }), 400);
  }
  const parsed = v.safeParse(SaveDiagnosisAnswerRequestSchema, input);
  if (!parsed.success) {
    return c.json(v.parse(InvalidRequestErrorSchema, { error: "Invalid request" }), 400);
  }

  const outcome = await saveDiagnosisAnswer({
    diagnosisId: c.req.param("diagnosisId") ?? "",
    diagnosisQuestionId: c.req.param("diagnosisQuestionId") ?? "",
    choiceId: parsed.output.choiceId,
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
    scheduleProjection: (task) => {
      try {
        const executionContext = c.executionCtx;
        executionContext.waitUntil(task());
      } catch {
        // BunのローカルサーバーにはExecutionContextがない。scheduled Workerが回収する。
      }
    },
  });

  switch (outcome.type) {
    case "saved":
      return c.json(
        v.parse(SaveDiagnosisAnswerResponseSchema, {
          outcome: outcome.outcome,
          answer: outcome.answer,
          progress: outcome.progress,
        }),
      );
    case "diagnosis-not-found":
      return c.json(
        v.parse(DiagnosisNotFoundErrorSchema, {
          error: "Diagnosis not found",
          reason: "diagnosis_not_found",
        }),
        404,
      );
    case "diagnosis-closed":
      return c.json(
        v.parse(DiagnosisClosedErrorSchema, {
          error: "Diagnosis closed",
          reason: "diagnosis_closed",
        }),
        409,
      );
    case "diagnosis-question-not-found":
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
          reason: "answer_is_immutable",
        }),
        409,
      );
  }
}

/** `PUT /api/diagnoses/:diagnosisId/deferred-questions/:diagnosisQuestionId` — 延期を保存する。 */
export async function putDiagnosisDeferredQuestion(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Diagnosis storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await deferDiagnosisQuestion({
    diagnosisId: c.req.param("diagnosisId") ?? "",
    diagnosisQuestionId: c.req.param("diagnosisQuestionId") ?? "",
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "deferred":
      return c.json(v.parse(DeferDiagnosisQuestionResponseSchema, outcome));
    case "diagnosis-not-found":
      return c.json(
        v.parse(DiagnosisNotFoundErrorSchema, {
          error: "Diagnosis not found",
          reason: "diagnosis_not_found",
        }),
        404,
      );
    case "diagnosis-closed":
      return c.json(
        v.parse(DiagnosisClosedErrorSchema, {
          error: "Diagnosis closed",
          reason: "diagnosis_closed",
        }),
        409,
      );
    case "diagnosis-question-not-found":
      return c.json(
        v.parse(InvalidDeferredQuestionErrorSchema, {
          error: "Invalid deferred question",
          reason: "diagnosis_question_not_found",
        }),
        422,
      );
    case "question-already-answered":
      return c.json(
        v.parse(QuestionAlreadyAnsweredErrorSchema, {
          error: "Question already answered",
          reason: "question_already_answered",
        }),
        409,
      );
  }
}

/** `GET /api/diagnoses/:diagnosisId/answers` — 本人が保存した回答内容を返す。 */
export async function getDiagnosisAnswerContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Diagnosis storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getDiagnosisAnswers({
    diagnosisId: c.req.param("diagnosisId") ?? "",
    actor: authenticatedActor(c),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(DiagnosisAnswersResponseSchema, outcome.diagnosis));
    case "diagnosis-answers-not-found":
      return c.json(
        v.parse(DiagnosisAnswersNotFoundErrorSchema, {
          error: "Diagnosis answers not found",
          reason: "diagnosis_answers_not_found",
        }),
        404,
      );
  }
}
