import { describe, expect, it } from "vitest";
import { normalizeDiaryRelativeDates } from "./diary";

describe("Diary Brain statement normalization", () => {
  it("来月を発言時点の日本時間で絶対年月へ変換する", () => {
    expect(
      normalizeDiaryRelativeDates(
        "来月までに転職先を決めたい",
        new Date("2026-08-11T03:00:00.000Z"),
      ),
    ).toEqual({
      statement: "2026年9月までに転職先を決めたい",
      temporalContext: {
        originalStatement: "来月までに転職先を決めたい",
        anchorDate: "2026-08-11",
        timeZone: "Asia/Tokyo",
        resolutions: [{ original: "来月", resolved: "2026年9月" }],
      },
    });
  });

  it("日本時間の日付と月・年の境界を越えて解決する", () => {
    expect(
      normalizeDiaryRelativeDates(
        "昨日決めて、来月から始めて、来年まで続けたい",
        new Date("2026-12-31T15:30:00.000Z"),
      ).statement,
    ).toBe("2026年12月31日決めて、2027年2月から始めて、2028年まで続けたい");
  });

  it("相対日付がない原文は変更せず、temporal contextも追加しない", () => {
    expect(
      normalizeDiaryRelativeDates(
        "2026/07/21 牛タンを食べた",
        new Date("2026-08-11T03:00:00.000Z"),
      ),
    ).toEqual({ statement: "2026/07/21 牛タンを食べた" });
  });
});
