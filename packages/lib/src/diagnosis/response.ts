import {
  type Diagnosis,
  findDiagnosisQuestion,
  findDiagnosisQuestionVersion,
  getDiagnosisAvailability,
} from "./diagnosis";
import type { Question } from "./question";
import { DiagnosisInteractionInputSchema, RecordDiagnosisAnswerInputSchema } from "./schema";
import { type DiagnosisResult, failure, success, validate } from "./types";

export type Respondent = Readonly<{
  accountId: string;
  status: "active" | "inactive";
}>;

export type Answer = Readonly<{
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  choiceId: string;
  acceptedAt: string;
  sourceRecordId: string;
}>;

export type DeferredQuestion = Readonly<{
  diagnosisQuestionId: string;
  deferredAt: string;
}>;

export type DiagnosisResponse = Readonly<{
  id: string;
  accountId: string;
  diagnosisId: string;
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
  diagnosisId: string;
  diagnosisQuestionId: string;
  questionId: string;
  questionVersion: number;
  choiceId: string;
  acceptedAt: string;
}>;

export type DiagnosisInteractionInput = {
  response?: DiagnosisResponse;
  /** Responseがまだ無い最初の操作でだけ必要。 */
  responseId?: string;
  diagnosis: Diagnosis;
  respondent: Respondent;
  diagnosisQuestionId: string;
  at: Date;
};

export type RecordDiagnosisAnswerInput = DiagnosisInteractionInput & {
  catalog: readonly Question[];
  choiceId: string;
  sourceRecordId: string;
};

export type RecordAnswerResult =
  | {
      outcome: "created";
      response: DiagnosisResponse;
      intent: CreateAnswerSourceRecordIntent;
    }
  | { outcome: "unchanged"; response: DiagnosisResponse };

export type DeferQuestionResult =
  | { outcome: "deferred"; response: DiagnosisResponse }
  | { outcome: "unchanged"; response: DiagnosisResponse };

function prepareResponse(input: DiagnosisInteractionInput): DiagnosisResult<DiagnosisResponse> {
  if (input.respondent.status !== "active") {
    return failure("account-inactive", "有効なAccountだけが回答できます");
  }
  if (getDiagnosisAvailability(input.diagnosis, input.at) !== "open") {
    return failure("diagnosis-not-open", "Diagnosisは受付中ではありません");
  }
  if (!findDiagnosisQuestion(input.diagnosis, input.diagnosisQuestionId)) {
    return failure("diagnosis-question-not-found", "Diagnosis Questionが見つかりません");
  }
  if (input.response) {
    if (input.response.accountId !== input.respondent.accountId) {
      return failure("response-owner-mismatch", "DiagnosisResponseの所有者が一致しません");
    }
    if (input.response.diagnosisId !== input.diagnosis.id) {
      return failure("response-diagnosis-mismatch", "DiagnosisResponseのDiagnosisが一致しません");
    }
    return success(input.response);
  }
  if (!input.responseId) {
    return failure("invalid-input", "最初の操作にはResponse IDが必要です");
  }
  return success({
    id: input.responseId,
    accountId: input.respondent.accountId,
    diagnosisId: input.diagnosis.id,
    answers: [],
    deferredQuestions: [],
  });
}

export function getResponseStatus(
  response: DiagnosisResponse | undefined,
  diagnosis: Diagnosis,
): ResponseStatus {
  const answeredQuestionIds = new Set(
    response?.answers.map((answer) => answer.diagnosisQuestionId),
  );
  const answered = diagnosis.questions.filter((question) =>
    answeredQuestionIds.has(question.id),
  ).length;
  if (answered === 0) {
    return "unanswered";
  }
  return answered === diagnosis.questions.length ? "answered" : "in-progress";
}

export function recordDiagnosisAnswer(
  input: RecordDiagnosisAnswerInput,
): DiagnosisResult<RecordAnswerResult> {
  const validated = validate(RecordDiagnosisAnswerInputSchema, input);
  if (!validated.ok) {
    return validated;
  }
  const prepared = prepareResponse(input);
  if (!prepared.ok) {
    return prepared;
  }

  const diagnosisQuestion = findDiagnosisQuestion(input.diagnosis, input.diagnosisQuestionId);
  if (!diagnosisQuestion) {
    return failure("diagnosis-question-not-found", "Diagnosis Questionが見つかりません");
  }
  const questionVersion = findDiagnosisQuestionVersion(diagnosisQuestion, input.catalog);
  if (!questionVersion) {
    return failure("question-version-not-found", "Question Versionが見つかりません");
  }
  if (!questionVersion.choices.some((choice) => choice.id === input.choiceId)) {
    return failure("choice-not-found", "ChoiceがQuestion Versionに存在しません");
  }

  const current = prepared.value.answers.find(
    (answer) => answer.diagnosisQuestionId === input.diagnosisQuestionId,
  );
  if (current?.choiceId === input.choiceId) {
    return success({ outcome: "unchanged", response: prepared.value });
  }
  if (current) {
    return failure("question-already-answered", "受理済みの診断回答は変更できません");
  }

  const acceptedAt = input.at.toISOString();
  const answer: Answer = {
    diagnosisQuestionId: diagnosisQuestion.id,
    questionId: diagnosisQuestion.questionId,
    questionVersion: diagnosisQuestion.questionVersion,
    choiceId: input.choiceId,
    acceptedAt,
    sourceRecordId: input.sourceRecordId,
  };
  const response: DiagnosisResponse = {
    ...prepared.value,
    answers: [...prepared.value.answers, answer],
    deferredQuestions: prepared.value.deferredQuestions.filter(
      (candidate) => candidate.diagnosisQuestionId !== diagnosisQuestion.id,
    ),
  };
  const intent: CreateAnswerSourceRecordIntent = {
    kind: "create-answer-source-record",
    sourceRecordId: input.sourceRecordId,
    sourceKind: "self-input",
    initialAccessLabel: "private",
    accountId: input.respondent.accountId,
    diagnosisId: input.diagnosis.id,
    diagnosisQuestionId: diagnosisQuestion.id,
    questionId: diagnosisQuestion.questionId,
    questionVersion: diagnosisQuestion.questionVersion,
    choiceId: input.choiceId,
    acceptedAt,
  };

  return success({ outcome: "created", response, intent });
}

export function deferDiagnosisQuestion(
  input: DiagnosisInteractionInput,
): DiagnosisResult<DeferQuestionResult> {
  const validated = validate(DiagnosisInteractionInputSchema, input);
  if (!validated.ok) {
    return validated;
  }
  const prepared = prepareResponse(input);
  if (!prepared.ok) {
    return prepared;
  }
  if (
    prepared.value.answers.some(
      (answer) => answer.diagnosisQuestionId === input.diagnosisQuestionId,
    )
  ) {
    return failure("question-already-answered", "回答済みの質問はあとで回答にできません");
  }
  if (
    prepared.value.deferredQuestions.some(
      (question) => question.diagnosisQuestionId === input.diagnosisQuestionId,
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
        { diagnosisQuestionId: input.diagnosisQuestionId, deferredAt: input.at.toISOString() },
      ],
    },
  });
}
