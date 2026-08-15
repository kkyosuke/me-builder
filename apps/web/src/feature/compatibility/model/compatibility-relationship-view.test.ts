import { describe, expect, it } from "vitest";
import { toCompatibilityPerson } from "./compatibility-relationship-view";

describe("toCompatibilityPerson", () => {
  it("審査済みの関わり方文だけを人物シートへ渡す", () => {
    const person = toCompatibilityPerson(
      {
        displayName: "あおい",
        aboutMe: {
          profileSummaryVersionId: "summary-1",
          generatedAt: "2026-08-15T00:00:00.000Z",
          statements: [{ key: "value", label: "価値観", statement: "私は予定を大切にします" }],
        },
        themes: [
          {
            diagnosisId: "planning",
            title: "時間と予定",
            parameters: [
              {
                id: "timing",
                label: "予定を決める時期",
                lowLabel: "その場で",
                highLabel: "早めに",
                position: 80,
                statement: "「早めに」傾向があります",
                request: "予定を早めに相談してもらえるとうれしいです。",
                band: "high",
              },
            ],
          },
        ],
      },
      "violet",
    );

    expect(person.themes[0]).toMatchObject({
      request: "予定を早めに相談してもらえるとうれしいです。",
      band: "high",
    });
  });
});
