import { describe, expect, it } from "vitest";
import {
  compatibilityPairProgressionLevel,
  compatibilityPairProgressionMarks,
  compatibilityPairProgressionThreshold,
  compatibilityRelationshipId,
  createCompatibilityRelationshipId,
} from "./compatibility-data";

describe("compatibility pair progression", () => {
  it("上限なしの二次式とLv.2・5・10以降10ごとのしるしを返す", () => {
    expect([1, 2, 3, 4, 5].map(compatibilityPairProgressionThreshold)).toEqual([0, 3, 12, 27, 48]);
    expect([0, 2, 3, 11, 12, 1_000_000].map(compatibilityPairProgressionLevel)).toEqual([
      1, 1, 2, 2, 3, 578,
    ]);
    expect(compatibilityPairProgressionMarks(29)).toEqual([2, 5, 10, 20]);
    expect(compatibilityPairProgressionMarks(30)).toEqual([2, 5, 10, 20, 30]);
  });
});

describe("compatibilityRelationshipId", () => {
  it("Account情報を含まない256 bitのhex tokenを毎回新しく作る", () => {
    const first = createCompatibilityRelationshipId();
    const second = createCompatibilityRelationshipId();

    expect(compatibilityRelationshipId.isValid(first)).toBe(true);
    expect(compatibilityRelationshipId.isValid(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("64文字の小文字16進数を受け入れる", () => {
    const id = "a".repeat(64);
    expect(compatibilityRelationshipId.isValid(id)).toBe(true);
  });

  it.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64)])("不正なID %s を拒否する", (id) =>
    expect(compatibilityRelationshipId.isValid(id)).toBe(false),
  );
});
