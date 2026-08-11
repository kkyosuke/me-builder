import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { CompatibilitySharePreviewOutcome } from "../logic/compatibility-share-preview";

const { getCompatibilitySharePreview } = vi.hoisted(() => ({
  getCompatibilitySharePreview: vi.fn(),
}));
vi.mock("../logic/compatibility-share-preview", () => ({ getCompatibilitySharePreview }));

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const previewToken = `csp2.${"a".repeat(64)}`;

function outcome(value: CompatibilitySharePreviewOutcome) {
  getCompatibilitySharePreview.mockResolvedValue(value);
}

function request(env: Record<string, unknown> = {}, authorization = "Bearer dummy.id.token") {
  return app.request(
    "/api/compatibility/share-preview",
    { headers: { Authorization: authorization } },
    {
      LIFF_ID: "2010850319-Yl63upAR",
      DB: dummyDb,
      ACCOUNT_DATA: dummyAccountData,
      ...env,
    },
  );
}

describe("GET /api/compatibility/share-preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolvedを200の共有プレビューへ変換する", async () => {
    outcome({
      type: "resolved",
      preview: {
        displayName: "あおい",
        previewToken,
        aboutMe: null,
        themes: [],
        canIssueInvitation: false,
        blockingReasons: ["diagnosis_required"],
        nextAction: "diagnosis",
      },
    });

    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      displayName: "あおい",
      previewToken,
      aboutMe: null,
      themes: [],
      canIssueInvitation: false,
      blockingReasons: ["diagnosis_required"],
      nextAction: "diagnosis",
    });
    expect(getCompatibilitySharePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "dummy.id.token",
        lineLoginChannelId: "2010850319",
        accountData: dummyAccountData,
      }),
    );
  });

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid" },
  ])("$typeを401へ変換する", async (value) => {
    outcome(value);

    const response = await request();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("Bearer形式でない認証情報をIDトークンとして渡さない", async () => {
    outcome({ type: "unauthenticated", reason: "missing" });

    await request({}, "Basic credentials");

    expect(getCompatibilitySharePreview).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: undefined }),
    );
  });

  it("Accountがなければ404を返す", async () => {
    outcome({ type: "account-not-found" });

    const response = await request();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
  });

  it("storage bindingがなければlogicを呼ばず503を返す", async () => {
    const response = await app.request(
      "/api/compatibility/share-preview",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID: "2010850319-Yl63upAR" },
    );

    expect(response.status).toBe(503);
    expect(getCompatibilitySharePreview).not.toHaveBeenCalled();
  });
});
