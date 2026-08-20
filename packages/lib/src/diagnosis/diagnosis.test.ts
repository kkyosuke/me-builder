import { describe, expect, it } from "vitest";
import {
  createDiagnosis,
  getDiagnosisAvailability,
  publishDiagnosis,
  withdrawDiagnosis,
} from "./diagnosis";
import { approveQuestionVersion, createQuestion, retireQuestionVersion } from "./question";
import { LIKERT_5_LABELS } from "./question-format";

function createApprovedQuestion(id: string) {
  const created = createQuestion(id, {
    text: `${id}の質問`,
    choices: [
      { id: "left", label: "左" },
      { id: "right", label: "右" },
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

function createApprovedLikertQuestion(id: string) {
  const created = createQuestion(id, {
    text: `${id}の質問`,
    format: "likert_5",
    choices: LIKERT_5_LABELS.map((label, index) => ({ id: `level-${index + 1}`, label })) as [
      { id: string; label: string },
      { id: string; label: string },
      { id: string; label: string },
      { id: string; label: string },
      { id: string; label: string },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);
  const approved = approveQuestionVersion(created.value, 1, new Date("2026-07-31T00:00:00Z"));
  if (!approved.ok) throw new Error(approved.error.message);
  return approved.value;
}

function createDraftDiagnosis() {
  const result = createDiagnosis({
    id: "daily-2026-08-01",
    title: "今日の診断",
    description: "今日の価値観を確認します。",
    opensAt: new Date("2026-08-01T00:00:00Z"),
    closesAt: new Date("2026-08-02T00:00:00Z"),
    questions: [
      { id: "dq-1", questionId: "q1", questionVersion: 1 },
      { id: "dq-2", questionId: "q2", questionVersion: 1 },
    ],
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("Diagnosis aggregate", () => {
  it("質問の配列順を固定してdraftを作成する", () => {
    const diagnosis = createDraftDiagnosis();

    expect(diagnosis.state).toBe("draft");
    expect(diagnosis.questions.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: "dq-1", position: 0 },
      { id: "dq-2", position: 1 },
    ]);
  });

  it("空のDiagnosis、重複Question、不正な受付期間を拒否する", () => {
    const empty = createDiagnosis({
      id: "empty",
      title: "empty",
      description: "empty diagnosis",
      opensAt: new Date("2026-08-01T00:00:00Z"),
      questions: [],
    });
    const duplicate = createDiagnosis({
      id: "duplicate",
      title: "duplicate",
      description: "duplicate diagnosis",
      opensAt: new Date("2026-08-01T00:00:00Z"),
      questions: [
        { id: "dq-1", questionId: "q1", questionVersion: 1 },
        { id: "dq-2", questionId: "q1", questionVersion: 2 },
      ],
    });
    const invalidPeriod = createDiagnosis({
      id: "period",
      title: "period",
      description: "period diagnosis",
      opensAt: new Date("2026-08-02T00:00:00Z"),
      closesAt: new Date("2026-08-01T00:00:00Z"),
      questions: [{ id: "dq-1", questionId: "q1", questionVersion: 1 }],
    });

    expect(empty).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(invalidPeriod).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("全Question Versionがapprovedの場合だけ公開する", () => {
    const draft = createDraftDiagnosis();
    const q1 = createApprovedQuestion("q1");
    const q2Draft = createQuestion("q2", {
      text: "q2の質問",
      choices: [
        { id: "left", label: "左" },
        { id: "right", label: "右" },
      ],
    });
    if (!q2Draft.ok) {
      throw new Error(q2Draft.error.message);
    }

    const rejected = publishDiagnosis(draft, [q1, q2Draft.value], new Date("2026-07-31T12:00:00Z"));
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "question-version-not-approved" },
    });

    const q2 = createApprovedQuestion("q2");
    const published = publishDiagnosis(draft, [q1, q2], new Date("2026-07-31T12:00:00Z"));
    expect(published).toMatchObject({
      ok: true,
      value: { state: "published", publishedAt: "2026-07-31T12:00:00.000Z" },
    });
  });

  it("1つのDiagnosisへ2択と5段階を混在させない", () => {
    const result = publishDiagnosis(
      createDraftDiagnosis(),
      [createApprovedQuestion("q1"), createApprovedLikertQuestion("q2")],
      new Date("2026-07-31T12:00:00Z"),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("retiredになったQuestion Versionでは新しく公開できない", () => {
    const q1 = createApprovedQuestion("q1");
    const retired = retireQuestionVersion(q1, 1, new Date("2026-07-31T12:00:00Z"));
    if (!retired.ok) {
      throw new Error(retired.error.message);
    }
    const diagnosis = createDiagnosis({
      id: "diagnosis",
      title: "diagnosis",
      description: "retired question diagnosis",
      opensAt: new Date("2026-08-01T00:00:00Z"),
      questions: [{ id: "dq-1", questionId: "q1", questionVersion: 1 }],
    });
    if (!diagnosis.ok) {
      throw new Error(diagnosis.error.message);
    }

    expect(publishDiagnosis(diagnosis.value, [retired.value], new Date())).toMatchObject({
      ok: false,
      error: { code: "question-version-not-approved" },
    });
  });

  it("公開前・受付中・受付終了を時刻から導出し、公開停止を終端状態にする", () => {
    const draft = createDraftDiagnosis();
    const published = publishDiagnosis(
      draft,
      [createApprovedQuestion("q1"), createApprovedQuestion("q2")],
      new Date("2026-07-31T12:00:00Z"),
    );
    if (!published.ok) {
      throw new Error(published.error.message);
    }

    expect(getDiagnosisAvailability(published.value, new Date("2026-07-31T23:59:59Z"))).toBe(
      "before-open",
    );
    expect(getDiagnosisAvailability(published.value, new Date("2026-08-01T00:00:00Z"))).toBe(
      "open",
    );
    expect(getDiagnosisAvailability(published.value, new Date("2026-08-02T00:00:00Z"))).toBe(
      "closed",
    );

    const withdrawn = withdrawDiagnosis(published.value, new Date("2026-08-01T12:00:00Z"));
    if (!withdrawn.ok) {
      throw new Error(withdrawn.error.message);
    }
    expect(getDiagnosisAvailability(withdrawn.value, new Date("2026-08-01T12:01:00Z"))).toBe(
      "withdrawn",
    );
    expect(withdrawDiagnosis(withdrawn.value, new Date())).toMatchObject({
      ok: false,
      error: { code: "invalid-transition" },
    });
  });
});
