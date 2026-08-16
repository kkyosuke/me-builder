import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const family = vi.hoisted(() => ({
  getFamilySeatManagement: vi.fn(),
  issueFamilySeatInvitation: vi.fn(),
  acceptFamilyInvitation: vi.fn(),
  declineFamilyInvitation: vi.fn(),
  cancelFamilyInvitation: vi.fn(),
  removeFamilyMember: vi.fn(),
  leaveFamilyPack: vi.fn(),
}));
vi.mock("../logic/family-seat-management", () => family);

const env = { DB: {} as D1Database, LIFF_ID: "2010850319-Yl63upAR" };
const headers = { Authorization: "Bearer verified.id.token", "Content-Type": "application/json" };
const seat = {
  id: "seat-2",
  slotNumber: 2,
  role: "member" as const,
  status: "invited" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

describe("family seat HTTP API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("支払者へ個人内容を含まない席状態だけを返す", async () => {
    family.getFamilySeatManagement.mockResolvedValue({
      type: "resolved",
      role: "payer",
      maxSeats: 4,
      seats: [seat],
    });
    const response = await app.request("/api/family/seats", { headers }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ role: "payer", maxSeats: 4, seats: [seat] });
  });

  it("招待発行を201で返し、tokenをno-storeにする", async () => {
    family.issueFamilySeatInvitation.mockResolvedValue({
      type: "created",
      token: "a".repeat(43),
      expiresAt: "2026-08-18T00:00:00.000Z",
      seat,
    });
    const response = await app.request("/api/family/invitations", { method: "POST", headers }, env);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("不正tokenを400、使用済みを409、権限外を403へ変換する", async () => {
    const invalid = await app.request(
      "/api/family/invitations/accept",
      { method: "POST", headers, body: JSON.stringify({ token: "short" }) },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(family.acceptFamilyInvitation).not.toHaveBeenCalled();

    family.acceptFamilyInvitation.mockResolvedValueOnce({ type: "token-used" });
    const used = await app.request(
      "/api/family/invitations/accept",
      { method: "POST", headers, body: JSON.stringify({ token: "a".repeat(43) }) },
      env,
    );
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({ reason: "token_used" });

    family.cancelFamilyInvitation.mockResolvedValue({ type: "forbidden" });
    const forbidden = await app.request(
      "/api/family/invitations/seat-2",
      { method: "DELETE", headers },
      env,
    );
    expect(forbidden.status).toBe(403);
  });

  it("D1 bindingがなければ503でlogicを呼ばない", async () => {
    const response = await app.request("/api/family/seats", { headers }, {});
    expect(response.status).toBe(503);
    expect(family.getFamilySeatManagement).not.toHaveBeenCalled();
  });
});
