import { describe, expect, it } from "vitest";
import { combineDiagnosisDefinition } from "./local-definitions";

describe("combineDiagnosisDefinition", () => {
  it("APIの質問へローカルのスコア関数と表示メタデータを結合する", () => {
    const definition = combineDiagnosisDefinition({
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

  it("ローカルのスコア設定がないDiagnosisは未対応として返す", () => {
    expect(
      combineDiagnosisDefinition({
        id: "unknown",
        title: "unknown",
        description: "unknown",
        questions: [],
      }),
    ).toBeUndefined();
  });
});
