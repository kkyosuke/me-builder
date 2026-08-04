import { describe, expect, it } from "vitest";
import { type Question, approveQuestionVersion, createQuestion } from "./question";
import {
  type Respondent,
  type SurveyResponse,
  deferSurveyQuestion,
  deleteSurveyAnswer,
  getResponseStatus,
  recordSurveyAnswer,
} from "./response";
import { type Survey, createSurvey, publishSurvey } from "./survey";

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

function publishedSurvey(catalog: readonly Question[]): Survey {
  const created = createSurvey({
    id: "survey-1",
    title: "今日のアンケート",
    description: "今日の価値観を確認します。",
    opensAt: new Date("2026-08-01T00:00:00Z"),
    closesAt: new Date("2026-08-02T00:00:00Z"),
    questions: [
      { id: "sq-1", questionId: "q1", questionVersion: 1 },
      { id: "sq-2", questionId: "q2", questionVersion: 1 },
    ],
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const published = publishSurvey(created.value, catalog, new Date("2026-07-31T12:00:00Z"));
  if (!published.ok) {
    throw new Error(published.error.message);
  }
  return published.value;
}

function fixture() {
  const catalog = [approvedQuestion("q1"), approvedQuestion("q2")];
  return { catalog, survey: publishedSurvey(catalog) };
}

function firstAnswer(
  survey: Survey,
  catalog: readonly Question[],
  overrides: Partial<Parameters<typeof recordSurveyAnswer>[0]> = {},
) {
  return recordSurveyAnswer({
    responseId: "response-1",
    survey,
    catalog,
    respondent: ACTIVE,
    surveyQuestionId: "sq-1",
    choiceId: "q1-left",
    sourceRecordId: "source-1",
    at: NOW,
    ...overrides,
  });
}

describe("SurveyResponse aggregate", () => {
  it("最初の回答でResponseとSource Record作成意図を作る", () => {
    const { catalog, survey } = fixture();
    const result = firstAnswer(survey, catalog);

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "created",
        response: {
          id: "response-1",
          accountId: "account-1",
          surveyId: "survey-1",
          answers: [
            {
              surveyQuestionId: "sq-1",
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
      expect(getResponseStatus(result.value.response, survey)).toBe("in-progress");
    }
  });

  it("全問の現在回答が揃ったときだけ回答済みにする", () => {
    const { catalog, survey } = fixture();
    const first = firstAnswer(survey, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const second = recordSurveyAnswer({
      response: first.value.response,
      survey,
      catalog,
      respondent: ACTIVE,
      surveyQuestionId: "sq-2",
      choiceId: "q2-right",
      sourceRecordId: "source-2",
      at: NOW,
    });
    if (!second.ok) {
      throw new Error(second.error.message);
    }

    expect(getResponseStatus(undefined, survey)).toBe("unanswered");
    expect(getResponseStatus(second.value.response, survey)).toBe("answered");
  });

  it("あとで回答は進捗だけを作り、Source Recordや回答件数を増やさない", () => {
    const { survey } = fixture();
    const result = deferSurveyQuestion({
      responseId: "response-1",
      survey,
      respondent: ACTIVE,
      surveyQuestionId: "sq-1",
      at: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "deferred",
        response: {
          answers: [],
          deferredQuestions: [{ surveyQuestionId: "sq-1", deferredAt: "2026-08-01T12:00:00.000Z" }],
        },
      },
    });
    if (result.ok) {
      expect(getResponseStatus(result.value.response, survey)).toBe("unanswered");
    }
  });

  it("同じChoiceの再送は変更なしとし、新しいSource Recordを要求しない", () => {
    const { catalog, survey } = fixture();
    const first = firstAnswer(survey, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const repeated = firstAnswer(survey, catalog, {
      response: first.value.response,
      sourceRecordId: "must-not-be-used",
    });

    expect(repeated).toEqual({
      ok: true,
      value: { outcome: "unchanged", response: first.value.response },
    });
  });

  it("Choiceの変更では新しいSource Recordと改訂対象を返す", () => {
    const { catalog, survey } = fixture();
    const first = firstAnswer(survey, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const revised = firstAnswer(survey, catalog, {
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
    const { catalog, survey } = fixture();
    const first = firstAnswer(survey, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const deleted = deleteSurveyAnswer({
      response: first.value.response,
      survey,
      respondent: ACTIVE,
      surveyQuestionId: "sq-1",
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
      expect(getResponseStatus(deleted.value.response, survey)).toBe("unanswered");
    }
  });

  it("無効Account、受付期間外、所有者不一致を拒否する", () => {
    const { catalog, survey } = fixture();
    const inactive = firstAnswer(survey, catalog, {
      respondent: { accountId: "account-1", status: "inactive" },
    });
    const closed = firstAnswer(survey, catalog, { at: new Date("2026-08-02T00:00:00Z") });
    const response: SurveyResponse = {
      id: "response-1",
      accountId: "other-account",
      surveyId: survey.id,
      answers: [],
      deferredQuestions: [],
    };
    const wrongOwner = firstAnswer(survey, catalog, { response });

    expect(inactive).toMatchObject({ ok: false, error: { code: "account-inactive" } });
    expect(closed).toMatchObject({ ok: false, error: { code: "survey-not-open" } });
    expect(wrongOwner).toMatchObject({
      ok: false,
      error: { code: "response-owner-mismatch" },
    });
  });

  it("最初の操作にはResponse IDを要求し、既存ResponseのSurvey不一致を拒否する", () => {
    const { catalog, survey } = fixture();
    const missingResponseId = recordSurveyAnswer({
      survey,
      catalog,
      respondent: ACTIVE,
      surveyQuestionId: "sq-1",
      choiceId: "q1-left",
      sourceRecordId: "source-1",
      at: NOW,
    });
    const wrongSurvey: SurveyResponse = {
      id: "response-1",
      accountId: ACTIVE.accountId,
      surveyId: "another-survey",
      answers: [],
      deferredQuestions: [],
    };
    const mismatch = firstAnswer(survey, catalog, { response: wrongSurvey });

    expect(missingResponseId).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(mismatch).toMatchObject({
      ok: false,
      error: { code: "response-survey-mismatch" },
    });
  });

  it("回答済みQuestionの延期を拒否し、同じ延期の再送は変更しない", () => {
    const { catalog, survey } = fixture();
    const first = firstAnswer(survey, catalog);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    const answered = deferSurveyQuestion({
      response: first.value.response,
      survey,
      respondent: ACTIVE,
      surveyQuestionId: "sq-1",
      at: NOW,
    });
    const deferred = deferSurveyQuestion({
      responseId: "response-2",
      survey,
      respondent: ACTIVE,
      surveyQuestionId: "sq-2",
      at: NOW,
    });
    if (!deferred.ok) {
      throw new Error(deferred.error.message);
    }
    const repeated = deferSurveyQuestion({
      response: deferred.value.response,
      survey,
      respondent: ACTIVE,
      surveyQuestionId: "sq-2",
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

  it("SurveyにないChoiceとQuestionを拒否する", () => {
    const { catalog, survey } = fixture();
    const unknownChoice = firstAnswer(survey, catalog, { choiceId: "unknown" });
    const unknownQuestion = firstAnswer(survey, catalog, { surveyQuestionId: "unknown" });

    expect(unknownChoice).toMatchObject({ ok: false, error: { code: "choice-not-found" } });
    expect(unknownQuestion).toMatchObject({
      ok: false,
      error: { code: "survey-question-not-found" },
    });
  });
});
