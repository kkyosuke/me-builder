import { describe, expect, it } from "vitest";
import { isRelationshipCategory, relationshipCategoryValues } from "./relationship-category";

describe("RelationshipCategory", () => {
  it("Diagnosisへ保存できるカテゴリだけを受け付ける", () => {
    expect(relationshipCategoryValues).toEqual(["partner", "family", "friend", "work", "general"]);
    expect(isRelationshipCategory("partner")).toBe(true);
    expect(isRelationshipCategory("general")).toBe(true);
    expect(isRelationshipCategory("other")).toBe(false);
    expect(isRelationshipCategory("unknown")).toBe(false);
  });
});
