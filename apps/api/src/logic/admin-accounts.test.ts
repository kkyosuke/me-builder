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
    const recordAudit = vi.fn().mockResolvedValue(undefined);
    await expect(
      getAdminAccounts({
        actor,
        db,
        input: { query: "山田", sort: "level" },
        auditEnabled: true,
        listAccounts,
        recordAudit,
      }),
    ).resolves.toEqual({ type: "resolved", page });
    expect(listAccounts).toHaveBeenCalledWith(db, { query: "山田", sort: "level" });
    expect(recordAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        adminReference: expect.stringMatching(/^account_[0-9a-f]{24}$/),
        queryPresent: true,
        resultCount: 0,
        total: 0,
      }),
    );
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
