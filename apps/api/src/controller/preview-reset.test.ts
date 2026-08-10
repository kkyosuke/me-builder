import { describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { ResettableDurableObjectNamespace } from "../types";

function namespace() {
  const resetStorage = vi.fn().mockResolvedValue(undefined);
  const restartAfterReset = vi.fn().mockRejectedValue(new Error("reset completed"));
  return {
    binding: {
      idFromString: vi.fn((id: string) => id),
      get: vi.fn(() => ({ resetStorage, restartAfterReset })),
    } as unknown as ResettableDurableObjectNamespace,
    resetStorage,
    restartAfterReset,
  };
}

function request(
  env: Record<string, unknown>,
  authorization = "Bearer reset-token",
  body: unknown = { className: "AccountData", objectIds: ["object-1", "object-2"] },
) {
  return app.request(
    "/api/internal/preview-reset/durable-objects",
    {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /api/internal/preview-reset/durable-objects", () => {
  it("一時tokenで指定したDO storageを削除する", async () => {
    const accountData = namespace();
    const response = await request({
      ENVIRONMENT: "preview",
      PREVIEW_RESET_TOKEN: "reset-token",
      ACCOUNT_DATA: accountData.binding,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reset: 2 });
    expect(accountData.resetStorage).toHaveBeenCalledTimes(2);
    expect(accountData.resetStorage).toHaveBeenCalledWith("reset-token");
    expect(accountData.restartAfterReset).toHaveBeenCalledTimes(2);
    expect(accountData.restartAfterReset).toHaveBeenCalledWith("reset-token");
  });

  it.each([
    [{ ENVIRONMENT: "production", PREVIEW_RESET_TOKEN: "reset-token" }, "Bearer reset-token"],
    [{ ENVIRONMENT: "preview", PREVIEW_RESET_TOKEN: "reset-token" }, "Bearer wrong"],
    [{ ENVIRONMENT: "preview" }, "Bearer reset-token"],
  ])("Preview以外または不正tokenでは404", async (env, authorization) => {
    expect((await request(env, authorization)).status).toBe(404);
  });

  it("不正なrequestは400", async () => {
    expect(
      (
        await request(
          { ENVIRONMENT: "preview", PREVIEW_RESET_TOKEN: "reset-token" },
          "Bearer reset-token",
          { className: "Unknown", objectIds: [] },
        )
      ).status,
    ).toBe(400);
  });

  it("reset token配布中は通常APIを503にする", async () => {
    const response = await app.request(
      "/api/health",
      {},
      {
        ENVIRONMENT: "preview",
        PREVIEW_RESET_TOKEN: "reset-token",
      },
    );
    expect(response.status).toBe(503);
  });
});
