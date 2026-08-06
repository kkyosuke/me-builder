import { describe, expect, it } from "vitest";
import { createLineRetryKey, isAcceptedLineRetryConflict } from "./line-delivery";

describe("createLineRetryKey", () => {
  it("同じSecretと配送identityから同じUUIDを生成する", async () => {
    const first = await createLineRetryKey("secret", "final:turn-1");
    const second = await createLineRetryKey("secret", "final:turn-1");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("配送identityが違えば別のkeyにする", async () => {
    await expect(createLineRetryKey("secret", "receipt:event-1")).resolves.not.toBe(
      await createLineRetryKey("secret", "final:event-1"),
    );
  });
});

describe("isAcceptedLineRetryConflict", () => {
  it("同じretry keyが既に受理済みの409を配送成功として扱う", () => {
    expect(isAcceptedLineRetryConflict({ status: 409 })).toBe(true);
  });

  it("409以外の配送エラーは再試行のため伝播する", () => {
    expect(isAcceptedLineRetryConflict({ status: 500 })).toBe(false);
  });
});
