import { describe, expect, it } from "vitest";
import { type Diagnosis, createDiagnosis, publishDiagnosis } from "./diagnosis";
import { type Question, approveQuestionVersion, createQuestion } from "./question";
import {
  type DiagnosisResponse,
  type Respondent,
  deferDiagnosisQuestion,
  deleteDiagnosisAnswer,
  getResponseStatus,
  recordDiagnosisAnswer,
} from "./response";

const NOW = new Date("2026-08-01T12:00:00Z");
const ACTIVE: Respondent = { accountId: "account-1", status: "active" };

function approvedQuestion(id: string): Question {
  const created = createQuestion(id, {
    text: `${id}の質問`,
    choices: [
      { id: `${id}-left`, label: "左" },
      { id: `${id}-right`, label: "右" },
    ],
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const approved = approveQuestionVersion(created.value, 1, new Date("2026-07-31T00:00:00Z"));
  if (!approved.ok) {
    throw new Error(approved.error.message);
  }
  return approved.value;
}

function publishedDiagnosis(catalog: readonly Question[]): Diagnosis {
  const created = createDiagnosis({
    id: "diagnosis-1",
    title: "今日の診断",
    description: "今日の価値観を確認します。",
    opensAt: new Date("2026-08-01T00:00:00Z"),
    closesAt: new Date("2026-08-02T00:00:00Z"),
    questions: [
      { id: "dq-1", questionId: "q1", questionVersion: 1 },
      { id: "dq-2", questionId: "q2", questionVersion: 1 },
    ],
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const published = publishDiagnosis(created.value, catalog, new Date("2026-07-31T12:00:00Z"));
  if (!published.ok) {
    throw new Error(published.error.message);
  }
  return published.value;
}

function fixture() {
  const catalog = [approvedQuestion("q1"), approvedQuestion("q2")];
  return { catalog, diagnosis: publishedDiagnosis(catalog) };
}

function firstAnswer(
  diagnosis: Diagnosis,
  catalog: readonly Question[],
  overrides: Partial<Parameters<typeof recordDiagnosisAnswer>[0]> = {},
) {
  return recordDiagnosisAnswer({
    responseId: "response-1",
    diagnosis,
    catalog,
    respondent: ACTIVE,
    diagnosisQuestionId: "dq-1",
    choiceId: "q1-left",
    sourceRecordId: "source-1",
    at: NOW,
    ...overrides,
  });
}

describe("DiagnosisResponse aggregate", () => {
  it("最初の回答でResponseとSource Record作成意図を作る", () => {
    const { catalog, diagnosis } = fixture();
    const result = firstAnswer(diagnosis, catalog);

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "created",
        response: {
          id: "response-1",
          accountId: "account-1",
          diagnosisId: "diagnosis-1",
          answers: [
            {
              diagnosisQuestionId: "dq-1",
              questionId: "q1",
              questionVersion: 1,
              choiceId: "q1-left",
              sourceRecordId: "source-1",
              acceptedAt: "2026-08-01T12:00:00.000Z",
            },
          ],
        },
        intent: {
          kind: "create-answer-source-record",
          sourceKind: "self-input",
          initialAccessLabel: "private",
          accountId: "account-1",
          sourceRecordId: "source-1",
        },
      },
    });
    if (result.ok) {
      expect(getResponseStatus(result.value.response, diagnosis)).toBe("in-progress");
    }
  });

  it("全問の現在回答が揃ったときだけ回答済みにする", () => {
    const { catalog, diagnosis } = fixture();
    const first = firstAnswer(diagnosis, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const second = recordDiagnosisAnswer({
      response: first.value.response,
      diagnosis,
      catalog,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-2",
      choiceId: "q2-right",
      sourceRecordId: "source-2",
      at: NOW,
    });
    if (!second.ok) {
      throw new Error(second.error.message);
    }

    expect(getResponseStatus(undefined, diagnosis)).toBe("unanswered");
    expect(getResponseStatus(second.value.response, diagnosis)).toBe("answered");
  });

  it("あとで回答は進捗だけを作り、Source Recordや回答件数を増やさない", () => {
    const { diagnosis } = fixture();
    const result = deferDiagnosisQuestion({
      responseId: "response-1",
      diagnosis,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-1",
      at: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "deferred",
        response: {
          answers: [],
          deferredQuestions: [
            { diagnosisQuestionId: "dq-1", deferredAt: "2026-08-01T12:00:00.000Z" },
          ],
        },
      },
    });
    if (result.ok) {
      expect(getResponseStatus(result.value.response, diagnosis)).toBe("unanswered");
    }
  });

  it("同じChoiceの再送は変更なしとし、新しいSource Recordを要求しない", () => {
    const { catalog, diagnosis } = fixture();
    const first = firstAnswer(diagnosis, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const repeated = firstAnswer(diagnosis, catalog, {
      response: first.value.response,
      sourceRecordId: "must-not-be-used",
    });

    expect(repeated).toEqual({
      ok: true,
      value: { outcome: "unchanged", response: first.value.response },
    });
  });

  it("Choiceの変更では新しいSource Recordと改訂対象を返す", () => {
    const { catalog, diagnosis } = fixture();
    const first = firstAnswer(diagnosis, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const revised = firstAnswer(diagnosis, catalog, {
      response: first.value.response,
      choiceId: "q1-right",
      sourceRecordId: "source-revised",
    });

    expect(revised).toMatchObject({
      ok: true,
      value: {
        outcome: "revised",
        response: { answers: [{ choiceId: "q1-right", sourceRecordId: "source-revised" }] },
        intent: { revisesSourceRecordId: "source-1" },
      },
    });
  });

  it("回答削除で現在回答を外し、Source Record削除意図を返す", () => {
    const { catalog, diagnosis } = fixture();
    const first = firstAnswer(diagnosis, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const deleted = deleteDiagnosisAnswer({
      response: first.value.response,
      diagnosis,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-1",
      at: NOW,
    });

    expect(deleted).toMatchObject({
      ok: true,
      value: {
        outcome: "deleted",
        response: { answers: [] },
        intent: { sourceRecordId: "source-1", accountId: "account-1" },
      },
    });
    if (deleted.ok) {
      expect(getResponseStatus(deleted.value.response, diagnosis)).toBe("unanswered");
    }
  });

  it("無効Account、受付期間外、所有者不一致を拒否する", () => {
    const { catalog, diagnosis } = fixture();
    const inactive = firstAnswer(diagnosis, catalog, {
      respondent: { accountId: "account-1", status: "inactive" },
    });
    const closed = firstAnswer(diagnosis, catalog, { at: new Date("2026-08-02T00:00:00Z") });
    const response: DiagnosisResponse = {
      id: "response-1",
      accountId: "other-account",
      diagnosisId: diagnosis.id,
      answers: [],
      deferredQuestions: [],
    };
    const wrongOwner = firstAnswer(diagnosis, catalog, { response });

    expect(inactive).toMatchObject({ ok: false, error: { code: "account-inactive" } });
    expect(closed).toMatchObject({ ok: false, error: { code: "diagnosis-not-open" } });
    expect(wrongOwner).toMatchObject({
      ok: false,
      error: { code: "response-owner-mismatch" },
    });
  });

  it("最初の操作にはResponse IDを要求し、既存ResponseのDiagnosis不一致を拒否する", () => {
    const { catalog, diagnosis } = fixture();
    const missingResponseId = recordDiagnosisAnswer({
      diagnosis,
      catalog,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-1",
      choiceId: "q1-left",
      sourceRecordId: "source-1",
      at: NOW,
    });
    const wrongDiagnosis: DiagnosisResponse = {
      id: "response-1",
      accountId: ACTIVE.accountId,
      diagnosisId: "another-diagnosis",
      answers: [],
      deferredQuestions: [],
    };
    const mismatch = firstAnswer(diagnosis, catalog, { response: wrongDiagnosis });

    expect(missingResponseId).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(mismatch).toMatchObject({
      ok: false,
      error: { code: "response-diagnosis-mismatch" },
    });
  });

  it("回答済みQuestionの延期を拒否し、同じ延期の再送は変更しない", () => {
    const { catalog, diagnosis } = fixture();
    const first = firstAnswer(diagnosis, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const answered = deferDiagnosisQuestion({
      response: first.value.response,
      diagnosis,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-1",
      at: NOW,
    });
    const deferred = deferDiagnosisQuestion({
      responseId: "response-2",
      diagnosis,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-2",
      at: NOW,
    });
    if (!deferred.ok) {
      throw new Error(deferred.error.message);
    }
    const repeated = deferDiagnosisQuestion({
      response: deferred.value.response,
      diagnosis,
      respondent: ACTIVE,
      diagnosisQuestionId: "dq-2",
      at: new Date("2026-08-01T12:01:00Z"),
    });

    expect(answered).toMatchObject({
      ok: false,
      error: { code: "question-already-answered" },
    });
    expect(repeated).toEqual({
      ok: true,
      value: { outcome: "unchanged", response: deferred.value.response },
    });
  });

  it("DiagnosisにないChoiceとQuestionを拒否する", () => {
    const { catalog, diagnosis } = fixture();
    const unknownChoice = firstAnswer(diagnosis, catalog, { choiceId: "unknown" });
    const unknownQuestion = firstAnswer(diagnosis, catalog, { diagnosisQuestionId: "unknown" });

    expect(unknownChoice).toMatchObject({ ok: false, error: { code: "choice-not-found" } });
    expect(unknownQuestion).toMatchObject({
      ok: false,
      error: { code: "diagnosis-question-not-found" },
    });
  });
});
