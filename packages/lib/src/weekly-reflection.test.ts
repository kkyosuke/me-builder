import { describe, expect, it } from "vitest";
import { jstWeekRange, resolveJstWeekStart } from "./weekly-reflection";

describe("weekly reflection week boundary", () => {
  it("Asia/Tokyoの月曜0時を週の開始として解決する", () => {
    expect(resolveJstWeekStart(new Date("2026-08-16T14:59:59.999Z"))).toBe("2026-08-10");
    expect(resolveJstWeekStart(new Date("2026-08-16T15:00:00.000Z"))).toBe("2026-08-17");
    expect(jstWeekRange("2026-08-17")).toEqual({
      from: new Date("2026-08-16T15:00:00.000Z"),
      until: new Date("2026-08-23T15:00:00.000Z"),
    });
  });

  it.each([
    ["月跨ぎ", "2026-08-30T14:59:59.999Z", "2026-08-24"],
    ["翌月の月曜", "2026-08-30T15:00:00.000Z", "2026-08-31"],
    ["年跨ぎ", "2027-01-03T14:59:59.999Z", "2026-12-28"],
    ["新年最初の月曜", "2027-01-03T15:00:00.000Z", "2027-01-04"],
  ] as const)("%sでも同じ日本日付の週を重複生成しない", (_name, instant, expected) => {
    expect(resolveJstWeekStart(new Date(instant))).toBe(expected);
  });
});
