import { describe, expect, it } from "vitest";
import {
  compatibilityCategoryFromSearch,
  compatibilityShareContentHref,
} from "./compatibility-category-navigation";

describe("compatibility category navigation", () => {
  it("指定したquery parameterから関係カテゴリを復元する", () => {
    expect(compatibilityCategoryFromSearch("?category=family", "category")).toBe("family");
    expect(compatibilityCategoryFromSearch("?shareCategory=friend", "shareCategory")).toBe(
      "friend",
    );
  });

  it("未指定、定義外、共有対象外のカテゴリはパートナーへ戻す", () => {
    expect(compatibilityCategoryFromSearch("", "shareCategory")).toBe("partner");
    expect(compatibilityCategoryFromSearch("?shareCategory=unknown", "shareCategory")).toBe(
      "partner",
    );
    expect(compatibilityCategoryFromSearch("?shareCategory=general", "shareCategory")).toBe(
      "partner",
    );
  });

  it("選択カテゴリを本人向け共有内容確認のURLへ引き継ぐ", () => {
    expect(compatibilityShareContentHref("work")).toBe("/me?shareCategory=work");
  });
});
