import { describe, expect, it } from "vitest";
import {
  compatibilityRelationshipId,
  createCompatibilityRelationshipId,
} from "./compatibility-data";

describe("compatibilityRelationshipId", () => {
  it("Account情報を含まない256 bitのhex tokenを毎回新しく作る", () => {
    const first = createCompatibilityRelationshipId();
    const second = createCompatibilityRelationshipId();

    expect(compatibilityRelationshipId.parse(first)).toBe(first);
    expect(compatibilityRelationshipId.parse(second)).toBe(second);
    expect(second).not.toBe(first);
  });

  it("64文字の小文字16進数を受け入れる", () => {
    const id = "a".repeat(64);
    expect(compatibilityRelationshipId.parse(id)).toBe(id);
  });

  it.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64)])("不正なID %s を拒否する", (id) =>
    expect(compatibilityRelationshipId.parse(id)).toBeUndefined(),
  );
});
