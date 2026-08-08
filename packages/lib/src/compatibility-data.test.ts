import { describe, expect, it } from "vitest";
import { createCompatibilityRelationshipId } from "./compatibility-data";

describe("createCompatibilityRelationshipId", () => {
  it("Account情報を含まない256 bitのhex tokenを毎回新しく作る", () => {
    const first = createCompatibilityRelationshipId();
    const second = createCompatibilityRelationshipId();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });
});
