import { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getAdminAccounts } from "./admin-accounts";

const db = {} as D1.shared.Client;

const actor = {
  accountId: "account",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

describe("getAdminAccounts", () => {
  it("管理者には共有D1の一覧だけを返す", async () => {
    const page = { accounts: [], total: 0, nextCursor: null };
    const listAccounts = vi.fn().mockResolvedValue(page);
    await expect(
      getAdminAccounts({
        actor,
        db,
        input: { query: "山田", sort: "level" },
        listAccounts,
      }),
    ).resolves.toEqual({ type: "resolved", page });
    expect(listAccounts).toHaveBeenCalledWith(db, { query: "山田", sort: "level" });
  });

  it("不正cursorをinvalid-requestへ変換する", async () => {
    await expect(
      getAdminAccounts({
        actor,
        db,
        input: { cursor: "invalid" },
        listAccounts: vi
          .fn()
          .mockRejectedValue(new D1.shared.action.adminAccount.InvalidAdminAccountCursorError()),
      }),
    ).resolves.toEqual({ type: "invalid-request" });
  });
});
