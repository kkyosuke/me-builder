import { describe, expect, it } from "vitest";
import { isRelationshipCategory, relationshipCategoryValues } from "./relationship-category";

describe("RelationshipCategory", () => {
  it("Diagnosisへ保存できるカテゴリだけを受け付ける", () => {
    expect(relationshipCategoryValues).toEqual([
      "partner",
      "family",
      "friend",
      "work",
      "other",
      "general",
    ]);
    expect(isRelationshipCategory("partner")).toBe(true);
    expect(isRelationshipCategory("general")).toBe(true);
    expect(isRelationshipCategory("unknown")).toBe(false);
  });
});
