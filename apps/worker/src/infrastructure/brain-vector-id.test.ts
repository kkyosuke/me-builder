import { describe, expect, it } from "vitest";
import { createBrainVectorId } from "./brain-vector-id";

describe("Brain vector ID", () => {
  it("同じBrain Item IDでもAccountが異なれば別のIDを生成する", async () => {
    const first = await createBrainVectorId("secret", "account-1", "brain-1");
    const second = await createBrainVectorId("secret", "account-2", "brain-1");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
