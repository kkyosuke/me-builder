import { describe, expect, it, vi } from "vitest";
import { resetDurableObjectStorage, restartDurableObjectAfterReset } from "./reset-storage";
import type { Env } from "./types";

function state() {
  return {
    storage: {
      deleteAlarm: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(undefined),
    },
    abort: vi.fn(() => {
      throw new Error("reset completed");
    }),
  } as unknown as DurableObjectState;
}

describe("Durable Object storage reset", () => {
  it("Previewの正しいtokenならalarmと全storageを削除する", async () => {
    const durableState = state();
    await resetDurableObjectStorage(
      durableState,
      { ENVIRONMENT: "preview", PREVIEW_RESET_TOKEN: "reset-token" } as Env,
      "reset-token",
    );
    expect(durableState.storage.deleteAlarm).toHaveBeenCalledOnce();
    expect(durableState.storage.deleteAll).toHaveBeenCalledOnce();
  });

  it("storage削除後にinstanceを再起動する", () => {
    const durableState = state();
    expect(() =>
      restartDurableObjectAfterReset(
        durableState,
        { ENVIRONMENT: "preview", PREVIEW_RESET_TOKEN: "reset-token" } as Env,
        "reset-token",
      ),
    ).toThrow("reset completed");
    expect(durableState.abort).toHaveBeenCalledWith("Preview storage reset completed");
  });

  it.each([
    [{ ENVIRONMENT: "production", PREVIEW_RESET_TOKEN: "reset-token" }, "reset-token"],
    [{ ENVIRONMENT: "preview", PREVIEW_RESET_TOKEN: "reset-token" }, "wrong-token"],
    [{ ENVIRONMENT: "preview" }, "reset-token"],
  ])("Preview以外または不正tokenでは削除しない", async (env, token) => {
    const durableState = state();
    await expect(resetDurableObjectStorage(durableState, env as Env, token)).rejects.toThrow(
      "not authorized",
    );
    expect(durableState.storage.deleteAll).not.toHaveBeenCalled();
  });
});
