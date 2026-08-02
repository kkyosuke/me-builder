import type { Question } from "./question";
import { RecordSurveyAnswerInputSchema, SurveyInteractionInputSchema } from "./schema";
import {
  type Survey,
  findSurveyQuestion,
  findSurveyQuestionVersion,
  getSurveyAvailability,
} from "./survey";
import { type QuestionnaireResult, failure, success, validate } from "./types";

export type Respondent = Readonly<{
  accountId: string;
  status: "active" | "inactive";
}>;

export type Answer = Readonly<{
  surveyQuestionId: string;
  questionId: string;
  questionVersion: number;
  choiceId: string;
  acceptedAt: string;
  sourceRecordId: string;
}>;

export type DeferredQuestion = Readonly<{
  surveyQuestionId: string;
  deferredAt: string;
}>;

export type SurveyResponse = Readonly<{
  id: string;
  accountId: string;
  surveyId: string;
  answers: readonly Answer[];
  deferredQuestions: readonly DeferredQuestion[];
}>;

export type ResponseStatus = "unanswered" | "in-progress" | "answered";

export type CreateAnswerSourceRecordIntent = Readonly<{
  kind: "create-answer-source-record";
  sourceRecordId: string;
  sourceKind: "self-input";
  initialAccessLabel: "private";
  accountId: string;
  surveyId: string;
  surveyQuestionId: string;
  questionId: string;
  questionVersion: number;
  choiceId: string;
  acceptedAt: string;
  revisesSourceRecordId?: string;
}>;

export type DeleteAnswerSourceRecordIntent = Readonly<{
  kind: "delete-answer-source-record";
  sourceRecordId: string;
  accountId: string;
  deletedAt: string;
}>;

export type SurveyInteractionInput = {
  response?: SurveyResponse;
  /** Responseがまだ無い最初の操作でだけ必要。 */
  responseId?: string;
  survey: Survey;
  respondent: Respondent;
  surveyQuestionId: string;
  at: Date;
};

export type RecordSurveyAnswerInput = SurveyInteractionInput & {
  catalog: readonly Question[];
  choiceId: string;
  sourceRecordId: string;
};

export type RecordAnswerResult =
  | {
      outcome: "created" | "revised";
      response: SurveyResponse;
      intent: CreateAnswerSourceRecordIntent;
    }
  | { outcome: "unchanged"; response: SurveyResponse };

export type DeferQuestionResult =
  | { outcome: "deferred"; response: SurveyResponse }
  | { outcome: "unchanged"; response: SurveyResponse };

export type DeleteAnswerResult =
  | { outcome: "deleted"; response: SurveyResponse; intent: DeleteAnswerSourceRecordIntent }
  | { outcome: "unchanged"; response: SurveyResponse };

function prepareResponse(input: SurveyInteractionInput): QuestionnaireResult<SurveyResponse> {
  if (input.respondent.status !== "active") {
    return failure("account-inactive", "有効なAccountだけが回答できます");
  }
  if (getSurveyAvailability(input.survey, input.at) !== "open") {
    return failure("survey-not-open", "Surveyは受付中ではありません");
  }
  if (!findSurveyQuestion(input.survey, input.surveyQuestionId)) {
    return failure("survey-question-not-found", "Survey Questionが見つかりません");
  }
  if (input.response) {
    if (input.response.accountId !== input.respondent.accountId) {
      return failure("response-owner-mismatch", "SurveyResponseの所有者が一致しません");
    }
    if (input.response.surveyId !== input.survey.id) {
      return failure("response-survey-mismatch", "SurveyResponseのSurveyが一致しません");
    }
    return success(input.response);
  }
  if (!input.responseId) {
    return failure("invalid-input", "最初の操作にはResponse IDが必要です");
  }
  return success({
    id: input.responseId,
    accountId: input.respondent.accountId,
    surveyId: input.survey.id,
    answers: [],
    deferredQuestions: [],
  });
}

export function getResponseStatus(
  response: SurveyResponse | undefined,
  survey: Survey,
): ResponseStatus {
  const answeredQuestionIds = new Set(response?.answers.map((answer) => answer.surveyQuestionId));
  const answered = survey.questions.filter((question) =>
    answeredQuestionIds.has(question.id),
  ).length;
  if (answered === 0) {
    return "unanswered";
  }
  return answered === survey.questions.length ? "answered" : "in-progress";
}

export function recordSurveyAnswer(
  input: RecordSurveyAnswerInput,
): QuestionnaireResult<RecordAnswerResult> {
  const validated = validate(RecordSurveyAnswerInputSchema, input);
  if (!validated.ok) {
    return validated;
  }
  const prepared = prepareResponse(input);
  if (!prepared.ok) {
    return prepared;
  }

  const surveyQuestion = findSurveyQuestion(input.survey, input.surveyQuestionId);
  if (!surveyQuestion) {
    return failure("survey-question-not-found", "Survey Questionが見つかりません");
  }
  const questionVersion = findSurveyQuestionVersion(surveyQuestion, input.catalog);
  if (!questionVersion) {
    return failure("question-version-not-found", "Question Versionが見つかりません");
  }
  if (!questionVersion.choices.some((choice) => choice.id === input.choiceId)) {
    return failure("choice-not-found", "ChoiceがQuestion Versionに存在しません");
  }

  const current = prepared.value.answers.find(
    (answer) => answer.surveyQuestionId === input.surveyQuestionId,
  );
  if (current?.choiceId === input.choiceId) {
    return success({ outcome: "unchanged", response: prepared.value });
  }

  const acceptedAt = input.at.toISOString();
  const answer: Answer = {
    surveyQuestionId: surveyQuestion.id,
    questionId: surveyQuestion.questionId,
    questionVersion: surveyQuestion.questionVersion,
    choiceId: input.choiceId,
    acceptedAt,
    sourceRecordId: input.sourceRecordId,
  };
  const response: SurveyResponse = {
    ...prepared.value,
    answers: [
      ...prepared.value.answers.filter(
        (candidate) => candidate.surveyQuestionId !== surveyQuestion.id,
      ),
      answer,
    ],
    deferredQuestions: prepared.value.deferredQuestions.filter(
      (candidate) => candidate.surveyQuestionId !== surveyQuestion.id,
    ),
  };
  const intent: CreateAnswerSourceRecordIntent = {
    kind: "create-answer-source-record",
    sourceRecordId: input.sourceRecordId,
    sourceKind: "self-input",
    initialAccessLabel: "private",
    accountId: input.respondent.accountId,
    surveyId: input.survey.id,
    surveyQuestionId: surveyQuestion.id,
    questionId: surveyQuestion.questionId,
    questionVersion: surveyQuestion.questionVersion,
    choiceId: input.choiceId,
    acceptedAt,
    ...(current ? { revisesSourceRecordId: current.sourceRecordId } : {}),
  };

  return success({ outcome: current ? "revised" : "created", response, intent });
}

export function deferSurveyQuestion(
  input: SurveyInteractionInput,
): QuestionnaireResult<DeferQuestionResult> {
  const validated = validate(SurveyInteractionInputSchema, input);
  if (!validated.ok) {
    return validated;
  }
  const prepared = prepareResponse(input);
  if (!prepared.ok) {
    return prepared;
  }
  if (prepared.value.answers.some((answer) => answer.surveyQuestionId === input.surveyQuestionId)) {
    return failure("question-already-answered", "回答済みの質問はあとで回答にできません");
  }
  if (
    prepared.value.deferredQuestions.some(
      (question) => question.surveyQuestionId === input.surveyQuestionId,
    )
  ) {
    return success({ outcome: "unchanged", response: prepared.value });
  }
  return success({
    outcome: "deferred",
    response: {
      ...prepared.value,
      deferredQuestions: [
        ...prepared.value.deferredQuestions,
        { surveyQuestionId: input.surveyQuestionId, deferredAt: input.at.toISOString() },
      ],
    },
  });
}

export function deleteSurveyAnswer(
  input: SurveyInteractionInput,
): QuestionnaireResult<DeleteAnswerResult> {
  const validated = validate(SurveyInteractionInputSchema, input);
  if (!validated.ok) {
    return validated;
  }
  const prepared = prepareResponse(input);
  if (!prepared.ok) {
    return prepared;
  }
  const current = prepared.value.answers.find(
    (answer) => answer.surveyQuestionId === input.surveyQuestionId,
  );
  if (!current) {
    return success({ outcome: "unchanged", response: prepared.value });
  }
  return success({
    outcome: "deleted",
    response: {
      ...prepared.value,
      answers: prepared.value.answers.filter(
        (answer) => answer.surveyQuestionId !== input.surveyQuestionId,
      ),
    },
    intent: {
      kind: "delete-answer-source-record",
      sourceRecordId: current.sourceRecordId,
      accountId: input.respondent.accountId,
      deletedAt: input.at.toISOString(),
    },
  });
}
