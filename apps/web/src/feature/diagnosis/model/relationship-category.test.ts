import { describe, expect, it } from "vitest";
import type { DiagnosisListItem } from "./diagnosis-list-item";
import {
  diagnosisCategoryHref,
  filterDiagnosesByRelationshipCategory,
  getRelationshipCategoryAnswerContext,
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryFilterClassName,
  relationshipCategoryFilterFromSearch,
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
    expect(filterDiagnosesByRelationshipCategory(diagnoses, "general").map(({ id }) => id)).toEqual(
      ["general"],
    );
    expect(filterDiagnosesByRelationshipCategory(diagnoses, "all")).toEqual(diagnoses);
  });

  it("カテゴリごとにラベルと選択チップの色を返す", () => {
    expect(getRelationshipCategoryBadgeClassName("partner")).toContain("bg-rose-100");
    expect(getRelationshipCategoryFilterClassName("partner")).toContain("aria-pressed:bg-rose-100");
    expect(getRelationshipCategoryBadgeClassName("family")).toContain("bg-amber-100");
    expect(getRelationshipCategoryBadgeClassName("friend")).toContain("bg-emerald-100");
    expect(getRelationshipCategoryBadgeClassName("work")).toContain("bg-blue-100");
    expect(getRelationshipCategoryBadgeClassName("general")).toContain("bg-slate-100");
    expect(getRelationshipCategoryFilterClassName("general")).toContain(
      "aria-pressed:bg-slate-100",
    );
  });

  it.each([
    ["partner", "パートナーとの関係"],
    ["family", "家族との関係"],
    ["friend", "友達との関係"],
    ["work", "仕事で関わる人との関係"],
    ["general", "普段の自分"],
  ] as const)("%s の回答時に思い浮かべる対象を返す", (category, expected) => {
    expect(getRelationshipCategoryAnswerContext(category)).toContain(expected);
  });

  it("categoryクエリから初期絞り込みを決め、未指定・無効値はallへ戻す", () => {
    expect(relationshipCategoryFilterFromSearch("?category=family")).toBe("family");
    expect(relationshipCategoryFilterFromSearch("?category=general")).toBe("general");
    expect(relationshipCategoryFilterFromSearch("?category=unknown")).toBe("all");
    expect(relationshipCategoryFilterFromSearch("")).toBe("all");
    expect(diagnosisCategoryHref("friend")).toBe("/diagnosis?category=friend");
  });
});
