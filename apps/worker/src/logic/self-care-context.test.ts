import { describe, expect, it } from "vitest";
import { classifySafety } from "./diary-chat";
import { shouldLoadSelfCareContext } from "./self-care-context";

describe("self-care context plan", () => {
  it.each([
    ["general", false],
    ["confirmed", true],
    ["personalized-history", true],
  ] as const)("Plan mode=%sの通常相談で参照可否を決める", (mode, expected) => {
    expect(
      shouldLoadSelfCareContext({
        mode,
        safetyRoute: "normal",
        currentText: "最近疲れていて、どうしたらいい？",
      }),
    ).toBe(expected);
  });

  it.each(["self_harm_possible", "imminent_danger", "abuse_or_violence"] as const)(
    "危機route=%sでは全Plan共通で個別化を止める",
    (safetyRoute) => {
      for (const mode of ["general", "confirmed", "personalized-history"] as const) {
        expect(
          shouldLoadSelfCareContext({
            mode,
            safetyRoute,
            currentText: "死にたい。どうしたらいい？",
          }),
        ).toBe(false);
      }
    },
  );

  it.each([
    ["今すぐ死ぬつもり", "imminent_danger"],
    ["消えてしまいたい", "self_harm_possible"],
    ["家で殴られていて怖い", "abuse_or_violence"],
  ] as const)("安全評価dataset: %s は %s をPlan差より優先する", (body, expectedRoute) => {
    const safetyRoute = classifySafety(
      [{ id: "current", sequence: 1, role: "user", body }],
      ["current"],
    );
    expect(safetyRoute).toBe(expectedRoute);
    for (const mode of ["general", "confirmed", "personalized-history"] as const) {
      expect(shouldLoadSelfCareContext({ mode, safetyRoute, currentText: body })).toBe(false);
    }
  });

  it("セルフケア相談でない通常会話へ機微な情報を混ぜない", () => {
    expect(
      shouldLoadSelfCareContext({
        mode: "personalized-history",
        safetyRoute: "normal",
        currentText: "今日の夕食はおいしかった",
      }),
    ).toBe(false);
  });
});
