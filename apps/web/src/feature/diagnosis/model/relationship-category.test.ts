import { describe, expect, it } from "vitest";
import type { DiagnosisListItem } from "./diagnosis-list-item";
import {
  availableRelationshipCategories,
  filterDiagnosesByRelationshipCategory,
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

  it("一覧に存在するカテゴリだけを定義順で返す", () => {
    expect(availableRelationshipCategories(diagnoses)).toEqual(["partner", "work", "general"]);
  });

  it("選択したカテゴリだけへ絞り込み、allでは全件を維持する", () => {
    expect(filterDiagnosesByRelationshipCategory(diagnoses, "work").map(({ id }) => id)).toEqual([
      "work",
    ]);
    expect(filterDiagnosesByRelationshipCategory(diagnoses, "all")).toEqual(diagnoses);
  });
});
