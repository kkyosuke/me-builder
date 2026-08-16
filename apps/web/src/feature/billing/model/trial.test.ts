import { describe, expect, it } from "vitest";
import { expectedTrialEndDate } from "./trial";

describe("expectedTrialEndDate", () => {
  it("日本時間の日付境界で14日後を案内する", () => {
    expect(expectedTrialEndDate(14, new Date("2026-08-16T14:59:59.000Z"))).toBe("2026年8月30日");
    expect(expectedTrialEndDate(14, new Date("2026-08-16T15:00:00.000Z"))).toBe("2026年8月31日");
  });
});
