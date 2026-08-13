import { describe, expect, it } from "vitest";
import type { DiagnosisListItem } from "./diagnosis-list-item";
import {
  filterDiagnosesByRelationshipCategory,
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryFilterClassName,
} from "./relationship-category";

function diagnosis(
  id: string,
  relationshipCategory: DiagnosisListItem["relationshipCategory"],
): DiagnosisListItem {
  return {
    id,
    title: id,
    description: "説明",
    relationshipCategory,
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: null,
    displayOrder: 1,
    availability: "open",
    responseStatus: "unanswered",
    answeredCount: 0,
    questionCount: 10,
    lastAnsweredAt: null,
  };
}

describe("relationship category filter", () => {
  const diagnoses = [
    diagnosis("work", "work"),
    diagnosis("partner", "partner"),
    diagnosis("general", "general"),
  ];

  it("選択したカテゴリだけへ絞り込み、allでは全件を維持する", () => {
    expect(filterDiagnosesByRelationshipCategory(diagnoses, "work").map(({ id }) => id)).toEqual([
      "work",
    ]);
    expect(filterDiagnosesByRelationshipCategory(diagnoses, "all")).toEqual(diagnoses);
  });

  it("カテゴリごとにラベルと選択チップの色を返す", () => {
    expect(getRelationshipCategoryBadgeClassName("partner")).toContain("bg-rose-100");
    expect(getRelationshipCategoryFilterClassName("partner")).toContain("aria-pressed:bg-rose-100");
    expect(getRelationshipCategoryBadgeClassName("family")).toContain("bg-amber-100");
    expect(getRelationshipCategoryBadgeClassName("friend")).toContain("bg-emerald-100");
    expect(getRelationshipCategoryBadgeClassName("work")).toContain("bg-blue-100");
    expect(getRelationshipCategoryBadgeClassName("other")).toContain("bg-violet-100");
    expect(getRelationshipCategoryBadgeClassName("general")).toContain("bg-slate-100");
  });
});
