import { describe, expect, it } from "vitest";
import {
  buildDiaryTemporalSearchText,
  readDiaryTemporalContext,
  resolveDiaryTemporalContext,
} from "./diary-temporal";

describe("Diary Brain temporal context", () => {
  it("原文を変えず、来月を発言時点の日本時間で絶対年月へ解決する", () => {
    const statement = "来月までに転職先を決めたい";
    const temporalContext = resolveDiaryTemporalContext(
      statement,
      new Date("2026-08-11T03:00:00.000Z"),
    );

    expect(temporalContext).toEqual({
      originalStatement: statement,
      anchorDate: "2026-08-11",
      timeZone: "Asia/Tokyo",
      resolutions: [{ original: "来月", resolved: "2026年9月" }],
    });
    expect(buildDiaryTemporalSearchText(statement, temporalContext)).toBe(
      "来月までに転職先を決めたい\n時点情報: 来月 = 2026年9月",
    );
  });

  it("日本時間の日付と月・年の境界を越えて解決する", () => {
    const statement = "昨日、決めて、来月から始めて、来年まで続けたい";
    const temporalContext = resolveDiaryTemporalContext(
      statement,
      new Date("2026-12-31T15:30:00.000Z"),
    );

    expect(temporalContext?.resolutions).toEqual([
      { original: "来月", resolved: "2027年2月" },
      { original: "来年", resolved: "2028年" },
      { original: "昨日", resolved: "2026年12月31日" },
    ]);
  });

  it("明日香や今日子を相対日付として扱わない", () => {
    const statement = "明日香さんと今日子さんに会った";
    expect(resolveDiaryTemporalContext(statement, new Date("2026-08-11T03:00:00.000Z"))).toBe(
      undefined,
    );
    expect(buildDiaryTemporalSearchText(statement)).toBe(statement);
  });

  it("相対日付がない原文にはtemporal contextを追加しない", () => {
    expect(
      resolveDiaryTemporalContext(
        "2026/07/21 牛タンを食べた",
        new Date("2026-08-11T03:00:00.000Z"),
      ),
    ).toBe(undefined);
  });

  it("不正な永続化属性をVector同期に利用しない", () => {
    expect(
      readDiaryTemporalContext({
        temporalContext: {
          originalStatement: "来月までに転職先を決めたい",
          anchorDate: "2026-08-11",
          timeZone: "Asia/Tokyo",
          resolutions: [{ original: "来月" }],
        },
      }),
    ).toBe(undefined);
  });
});
