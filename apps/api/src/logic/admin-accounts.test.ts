import { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getAdminAccounts } from "./admin-accounts";
import type { createLiffSession } from "./liff-session";

const db = {} as D1.shared.Client;

function session(role: "user" | "admin"): typeof createLiffSession {
  return async () => ({ type: "resolved", session: { accountId: "account", role } });
}

describe("getAdminAccounts", () => {
  it("通常Accountには一覧を返さない", async () => {
    await expect(
      getAdminAccounts({
        idToken: "id-token",
        lineLoginChannelId: "channel",
        adminLineUserIds: [],
        db,
        input: {},
        createSession: session("user"),
      }),
    ).resolves.toEqual({ type: "forbidden" });
  });

  it("管理者には共有D1の一覧だけを返す", async () => {
    const page = { accounts: [], total: 0, nextCursor: null };
    const listAccounts = vi.fn().mockResolvedValue(page);
    await expect(
      getAdminAccounts({
        idToken: "id-token",
        lineLoginChannelId: "channel",
        adminLineUserIds: [],
        db,
        input: { query: "山田", sort: "level" },
        createSession: session("admin"),
        listAccounts,
      }),
    ).resolves.toEqual({ type: "resolved", page });
    expect(listAccounts).toHaveBeenCalledWith(db, { query: "山田", sort: "level" });
  });

  it("不正cursorをinvalid-requestへ変換する", async () => {
    await expect(
      getAdminAccounts({
        idToken: "id-token",
        lineLoginChannelId: "channel",
        adminLineUserIds: [],
        db,
        input: { cursor: "invalid" },
        createSession: session("admin"),
        listAccounts: vi
          .fn()
          .mockRejectedValue(new D1.shared.action.adminAccount.InvalidAdminAccountCursorError()),
      }),
    ).resolves.toEqual({ type: "invalid-request" });
  });
});
