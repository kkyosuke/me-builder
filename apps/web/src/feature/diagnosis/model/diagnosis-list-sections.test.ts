import { describe, expect, it } from "vitest";
import type { DiagnosisListItem } from "./diagnosis-list-item";
import { buildDiagnosisListSections } from "./diagnosis-list-sections";

function diagnosis(overrides: Partial<DiagnosisListItem>): DiagnosisListItem {
  return {
    id: "diagnosis",
    title: "診断",
    description: "説明",
    relationshipCategory: "general",
    opensAt: "2026-08-04T00:00:00.000Z",
    closesAt: null,
    displayOrder: 10,
    availability: "open",
    responseStatus: "unanswered",
    answeredCount: 0,
    questionCount: 10,
    lastAnsweredAt: null,
    ...overrides,
  };
}

describe("buildDiagnosisListSections", () => {
  it("回答途中は回答数、未回答は表示順、回答済みは最終回答日時で並べる", () => {
    const result = buildDiagnosisListSections([
      diagnosis({ id: "unanswered-later", displayOrder: 20 }),
      diagnosis({
        id: "answered-old",
        responseStatus: "answered",
        answeredCount: 10,
        lastAnsweredAt: "2026-08-04T00:00:00.000Z",
      }),
      diagnosis({
        id: "progress-more",
        responseStatus: "in-progress",
        answeredCount: 8,
        displayOrder: 30,
      }),
      diagnosis({ id: "unanswered-first", displayOrder: 10 }),
      diagnosis({
        id: "answered-new",
        responseStatus: "answered",
        answeredCount: 10,
        lastAnsweredAt: "2026-08-06T00:00:00.000Z",
      }),
      diagnosis({
        id: "progress-less",
        responseStatus: "in-progress",
        answeredCount: 3,
        displayOrder: 10,
      }),
    ]);

    expect(result.inProgress.map(({ id }) => id)).toEqual(["progress-more", "progress-less"]);
    expect(result.unanswered.map(({ id }) => id)).toEqual(["unanswered-first", "unanswered-later"]);
    expect(result.answered.map(({ id }) => id)).toEqual(["answered-new", "answered-old"]);
  });

  it("同順位は表示順、Diagnosis IDで安定させる", () => {
    const result = buildDiagnosisListSections([
      diagnosis({ id: "b", displayOrder: 10 }),
      diagnosis({ id: "later", displayOrder: 20 }),
      diagnosis({ id: "a", displayOrder: 10 }),
    ]);

    expect(result.unanswered.map(({ id }) => id)).toEqual(["a", "b", "later"]);
  });
});
