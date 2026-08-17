import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptFamilyInvitation,
  cancelFamilyInvitation,
  fetchFamilySeats,
  issueFamilyInvitation,
  leaveFamilyPack,
} from "./family-api";

const seat = {
  id: "seat-2",
  slotNumber: 2,
  role: "member",
  status: "active",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T01:00:00.000Z",
};

describe("family api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("アプリセッション付きで席一覧と招待tokenを検証する", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "member", maxSeats: 4, seats: [seat] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: "a".repeat(43), expiresAt: "2026-08-18T00:00:00.000Z", seat }),
        ),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchFamilySeats("https://api.example.com")).resolves.toMatchObject({
      role: "member",
    });
    await expect(issueFamilyInvitation("https://api.example.com")).resolves.toMatchObject({
      token: "a".repeat(43),
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/family/seats",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("承諾tokenをJSON bodyで送り、席IDをURL encodeして取消する", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ seat })));
    vi.stubGlobal("fetch", fetch);
    await acceptFamilyInvitation("", "a".repeat(43));
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/family/invitations/accept",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "a".repeat(43) }) }),
    );
    await cancelFamilyInvitation("", "seat/2");
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/family/invitations/seat%2F2",
      expect.objectContaining({ method: "DELETE" }),
    );
    await leaveFamilyPack("");
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/family/membership",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("期限切れ・使用済み・別pack所属を利用者向け理由へ変換する", async () => {
    for (const [reason, expected] of [
      ["invitation_expired", "有効期限"],
      ["token_used", "すでに使用"],
      ["account_already_assigned", "別のファミリーパック"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: "Family operation unavailable", reason }), {
            status: 409,
          }),
        ),
      );
      await expect(acceptFamilyInvitation("", "a".repeat(43))).rejects.toThrow(expected);
    }
  });
});
