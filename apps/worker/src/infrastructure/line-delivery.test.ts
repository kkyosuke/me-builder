import { describe, expect, it } from "vitest";
import {
  createLineRetryKey,
  getLineDeliveryFailureKind,
  isAcceptedLineRetryConflict,
} from "./line-delivery";

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

describe("getLineDeliveryFailureKind", () => {
  it("恒久的な4xxと再試行可能なtimeout・5xxを分ける", () => {
    expect(getLineDeliveryFailureKind({ status: 400 })).toBe("permanent");
    expect(getLineDeliveryFailureKind({ status: 429 })).toBe("transient");
    expect(getLineDeliveryFailureKind({ status: 500 })).toBe("transient");
    expect(getLineDeliveryFailureKind(new Error("timeout"))).toBe("transient");
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
