import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminAccounts } from "./admin-api";

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

  it("検索・絞り込み・並び順・cursorを認証付きで送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAdminAccounts(
        "https://api.example.com",
        "id-token",
        { query: " 山田 ", role: "user", status: "active", sort: "level" },
        "cursor-value",
      ),
    ).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/admin/accounts?query=%E5%B1%B1%E7%94%B0&role=user&status=active&sort=level&cursor=cursor-value",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });
});
