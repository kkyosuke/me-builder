import { describe, expect, it } from "vitest";
import { combineSurveyDefinition } from "./local-definitions";

describe("combineSurveyDefinition", () => {
  it("APIの質問へローカルのスコア関数と表示メタデータを結合する", () => {
    const definition = combineSurveyDefinition({
      id: "relationship-priority",
      title: "API title",
      description: "API description",
      questions: [],
    });

    expect(definition).toMatchObject({
      id: "relationship-priority",
      title: "API title",
      description: "API description",
      balancedLabel: "状況に応じて調整",
    });
    expect(() => definition?.score([])).not.toThrow();
  });

  it("ローカルのスコア設定がないSurveyは未対応として返す", () => {
    expect(
      combineSurveyDefinition({
        id: "unknown",
        title: "unknown",
        description: "unknown",
        questions: [],
      }),
    ).toBeUndefined();
  });
});
