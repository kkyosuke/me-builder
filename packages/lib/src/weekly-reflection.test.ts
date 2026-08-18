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
});
