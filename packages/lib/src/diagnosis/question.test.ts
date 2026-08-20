import { describe, expect, it } from "vitest";
import {
  addQuestionVersion,
  approveQuestionVersion,
  createQuestion,
  retireQuestionVersion,
} from "./question";
import { LIKERT_5_LABELS } from "./question-format";

const CHOICES = [
  { id: "stay-home", label: "家で過ごす", presentation: { icon: "house" } },
  { id: "go-out", label: "外へ出る", presentation: { icon: "mountain" } },
] as const;

function createValidQuestion() {
  const result = createQuestion("holiday-style", {
    text: "休日はどちらの過ごし方に近いですか？",
    choices: CHOICES,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("Question aggregate", () => {
  it("最初のdraft版を作成する", () => {
    const question = createValidQuestion();

    expect(question).toEqual({
      id: "holiday-style",
      versions: [
        {
          version: 1,
          state: "draft",
          text: "休日はどちらの過ごし方に近いですか？",
          format: "single_choice",
          choices: CHOICES,
        },
      ],
    });
  });

  it("Choice IDの重複と空の質問文を拒否する", () => {
    const duplicateChoice = createQuestion("q1", {
      text: "質問",
      choices: [
        { id: "same", label: "A" },
        { id: "same", label: "B" },
      ],
    });
    const emptyText = createQuestion("q1", { text: " ", choices: CHOICES });

    expect(duplicateChoice).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(emptyText).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("固定ラベルを持つ5段階のdraft版を作成する", () => {
    const result = createQuestion("likert", {
      text: "当てはまりますか",
      format: "likert_5",
      choices: LIKERT_5_LABELS.map((label, index) => ({ id: `level-${index + 1}`, label })) as [
        { id: string; label: string },
        { id: string; label: string },
        { id: string; label: string },
        { id: string; label: string },
        { id: string; label: string },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.versions[0]).toMatchObject({ format: "likert_5" });
      expect(result.value.versions[0]?.choices).toHaveLength(5);
      expect(result.value.versions[0]?.choices[0]).toMatchObject({ id: "level-1" });
    }
  });

  it("draftをapproveし、既存内容を変えずに次の版を追加する", () => {
    const original = createValidQuestion();
    const approved = approveQuestionVersion(original, 1, new Date("2026-08-01T00:00:00Z"));
    if (!approved.ok) {
      throw new Error(approved.error.message);
    }
    const revised = addQuestionVersion(approved.value, {
      text: "予定のない休日は、どちらに近いですか？",
      hint: "より多い方を選んでください",
      choices: CHOICES,
    });
    if (!revised.ok) {
      throw new Error(revised.error.message);
    }

    expect(original.versions[0]?.state).toBe("draft");
    expect(revised.value.versions).toHaveLength(2);
    expect(revised.value.versions[0]).toMatchObject({ version: 1, state: "approved" });
    expect(revised.value.versions[1]).toMatchObject({ version: 2, state: "draft" });
  });

  it("approvedだけをretireでき、無効な状態遷移を拒否する", () => {
    const question = createValidQuestion();
    const invalid = retireQuestionVersion(question, 1, new Date("2026-08-01T00:00:00Z"));
    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid-transition" } });

    const approved = approveQuestionVersion(question, 1, new Date("2026-08-01T00:00:00Z"));
    if (!approved.ok) {
      throw new Error(approved.error.message);
    }
    const retired = retireQuestionVersion(approved.value, 1, new Date("2026-08-02T00:00:00Z"));

    expect(retired).toMatchObject({
      ok: true,
      value: { versions: [{ state: "retired", retiredAt: "2026-08-02T00:00:00.000Z" }] },
    });
  });
});
