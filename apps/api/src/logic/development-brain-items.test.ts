import type { AccountDataNamespace, sharedD1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getDevelopmentBrainItems } from "./development-brain-items";

const db = {} as sharedD1.Client;
const accountData = {} as AccountDataNamespace;

function dependencies() {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    }),
    listActive: vi.fn().mockResolvedValue({ items: [], truncated: false }),
  };
}

describe("getDevelopmentBrainItems", () => {
  it("本人確認で解決したAccountのactive Itemを取得する", async () => {
    const deps = dependencies();

    await expect(
      getDevelopmentBrainItems(
        { idToken: "token", lineLoginChannelId: "channel", db, accountData },
        deps,
      ),
    ).resolves.toEqual({ type: "resolved", items: [], truncated: false });
    expect(deps.listActive).toHaveBeenCalledWith(accountData, "account-1");
  });

  it("本人を解決できなければAccountDataを参照しない", async () => {
    const deps = dependencies();
    deps.createSession.mockResolvedValue({ type: "unauthenticated", reason: "invalid" } as never);

    await expect(
      getDevelopmentBrainItems(
        { idToken: undefined, lineLoginChannelId: "channel", db, accountData },
        deps,
      ),
    ).resolves.toEqual({ type: "unauthenticated", reason: "invalid" });
    expect(deps.listActive).not.toHaveBeenCalled();
  });
});
