import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminAccounts, fetchAdminStatistics } from "./admin-api";

const page = {
  accounts: [
    {
      id: "account-1",
      displayName: "山田 花子",
      role: "user",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      progression: { status: "pending" },
    },
  ],
  total: 1,
  nextCursor: "next-cursor",
};

describe("Admin Account API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("検索・絞り込み・並び順・cursorをアプリセッション付きで送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAdminAccounts(
        "https://api.example.com",
        { query: " 山田 ", role: "user", status: "active", sort: "level" },
        "cursor-value",
      ),
    ).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/admin/accounts?query=%E5%B1%B1%E7%94%B0&role=user&status=active&sort=level&cursor=cursor-value",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it.each([
    [
      "Account一覧",
      () =>
        fetchAdminAccounts(undefined, { query: "", role: "all", status: "all", sort: "created" }),
    ],
    ["統計", () => fetchAdminStatistics(undefined)],
  ])("表示上のroleに関係なく%s APIの403を権限不足として扱う", async (_name, request) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(request()).rejects.toThrow("管理者権限がありません");
  });
});
