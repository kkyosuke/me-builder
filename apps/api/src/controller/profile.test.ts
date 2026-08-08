import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { ProfileSummaryOutcome } from "../logic/profile-summary";

const { getProfileSummary } = vi.hoisted(() => ({ getProfileSummary: vi.fn() }));
vi.mock("../logic/profile-summary", () => ({ getProfileSummary }));

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const outcome = (value: ProfileSummaryOutcome) => getProfileSummary.mockResolvedValue(value);

function request(withDb = true) {
  return app.request(
    "/api/profile-summary",
    { headers: { Authorization: "Bearer dummy.id.token" } },
    {
      LIFF_ID: "2010850319-Yl63upAR",
      ...(withDb ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}),
    },
  );
}

describe("GET /api/profile-summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("生成済みのまとめと次の行動を返す", async () => {
    outcome({
      type: "resolved",
      summary: null,
      nextAction: "diagnosis",
    });

    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: null, nextAction: "diagnosis" });
    expect(getProfileSummary).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "dummy.id.token", lineLoginChannelId: "2010850319" }),
    );
  });

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid" },
  ])("$typeを401へ変換する", async (value) => {
    outcome(value);
    const response = await request();
    expect(response.status).toBe(401);
  });

  it("Accountがなければ友だち追加を案内する404を返す", async () => {
    outcome({ type: "account-not-found" });
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
  });

  it("DB bindingがなければ503を返す", async () => {
    const response = await request(false);
    expect(response.status).toBe(503);
    expect(getProfileSummary).not.toHaveBeenCalled();
  });
});
