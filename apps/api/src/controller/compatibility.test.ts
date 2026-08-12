import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { CompatibilitySharePreviewOutcome } from "../logic/compatibility-share-preview";

const { getCompatibilitySharePreview } = vi.hoisted(() => ({
  getCompatibilitySharePreview: vi.fn(),
}));
const { issueCompatibilityInvitation } = vi.hoisted(() => ({
  issueCompatibilityInvitation: vi.fn(),
}));
const { getCompatibilityInvitationContents } = vi.hoisted(() => ({
  getCompatibilityInvitationContents: vi.fn(),
}));
vi.mock("../logic/compatibility-share-preview", () => ({ getCompatibilitySharePreview }));
vi.mock("../logic/compatibility-invitation", () => ({ issueCompatibilityInvitation }));
vi.mock("../logic/compatibility-invitation-preview", () => ({
  getCompatibilityInvitationContents,
}));

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const dummyCompatibilityData = {} as CompatibilityDataNamespace;
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

describe("POST /api/compatibility/invitations", () => {
  beforeEach(() => vi.clearAllMocks());

  function issueRequest(body: unknown, env: Record<string, unknown> = {}) {
    return app.request(
      "/api/compatibility/invitations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer dummy.id.token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      {
        LIFF_ID: "2010850319-Yl63upAR",
        WEB_ORIGIN: "https://example.com",
        DB: dummyDb,
        ACCOUNT_DATA: dummyAccountData,
        COMPATIBILITY_DATA: dummyCompatibilityData,
        ...env,
      },
    );
  }

  it("createdを201の招待URLへ変換する", async () => {
    issueCompatibilityInvitation.mockResolvedValue({
      type: "created",
      invitationUrl: `https://liff.line.me/2010850319-Yl63upAR/compatibility/invitations/${"1".repeat(64)}`,
      expiresAt: "2026-08-26T00:00:00.000Z",
    });

    const response = await issueRequest({ previewToken });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      invitationUrl: `https://liff.line.me/2010850319-Yl63upAR/compatibility/invitations/${"1".repeat(64)}`,
      expiresAt: "2026-08-26T00:00:00.000Z",
    });
    expect(issueCompatibilityInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "dummy.id.token",
        previewToken,
        liffId: "2010850319-Yl63upAR",
        accountData: dummyAccountData,
        compatibilityData: dummyCompatibilityData,
      }),
    );
  });

  it.each([
    { type: "preview-changed" as const, reason: "preview_changed" },
    { type: "share-unavailable" as const, reason: "share_unavailable" },
  ])("$typeを409へ変換する", async ({ type, reason }) => {
    issueCompatibilityInvitation.mockResolvedValue({ type });
    const response = await issueRequest({ previewToken });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Compatibility invitation unavailable",
      reason,
    });
  });

  it("不正なpreviewTokenではlogicを呼ばず400を返す", async () => {
    const response = await issueRequest({ previewToken: "invalid" });

    expect(response.status).toBe(400);
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });

  it("CompatibilityData bindingがなければ503を返す", async () => {
    const response = await issueRequest({ previewToken }, { COMPATIBILITY_DATA: undefined });

    expect(response.status).toBe(503);
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });

  it("LIFF_IDがなければ招待を作成せず503を返す", async () => {
    const response = await issueRequest({ previewToken }, { LIFF_ID: undefined });

    expect(response.status).toBe(503);
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });
});

describe("GET /api/compatibility/invitations/:relationshipId", () => {
  beforeEach(() => vi.clearAllMocks());

  const relationshipId = "1".repeat(64);
  const invitation = {
    inviter: {
      displayName: "あおい",
      aboutMe: {
        profileSummaryVersionId: "profile-inviter",
        generatedAt: "2026-08-11T00:00:00.000Z",
        statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
      },
      themes: [
        {
          diagnosisId: "diagnosis-1",
          title: "時間と予定",
          parameters: [
            {
              id: "planning",
              label: "予定",
              lowLabel: "その場",
              highLabel: "早め",
              position: 80,
              statement: "「早め」傾向があります",
            },
          ],
        },
      ],
    },
    recipient: {
      displayName: "はる",
      previewToken,
      aboutMe: null,
      themes: [],
    },
    expiresAt: "2026-08-26T00:00:00.000Z",
    canAccept: false,
    blockingReasons: ["profile_summary_required", "common_diagnosis_required"],
    nextAction: "profile-summary",
  };

  function invitationRequest(env: Record<string, unknown> = {}) {
    return app.request(
      `/api/compatibility/invitations/${relationshipId}`,
      { headers: { Authorization: "Bearer dummy.id.token" } },
      {
        LIFF_ID: "2010850319-Yl63upAR",
        DB: dummyDb,
        ACCOUNT_DATA: dummyAccountData,
        COMPATIBILITY_DATA: dummyCompatibilityData,
        ...env,
      },
    );
  }

  it("resolvedをno-storeの200へ変換する", async () => {
    getCompatibilityInvitationContents.mockResolvedValue({ type: "resolved", invitation });

    const response = await invitationRequest();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(invitation);
    expect(getCompatibilityInvitationContents).toHaveBeenCalledWith(
      expect.objectContaining({
        relationshipId,
        idToken: "dummy.id.token",
        accountData: dummyAccountData,
        compatibilityData: dummyCompatibilityData,
      }),
    );
  });

  it.each([
    { type: "unavailable" as const, status: 404, reason: "invitation_unavailable" },
    { type: "own-invitation" as const, status: 409, reason: "own_invitation" },
  ])("$typeを推測可能な情報を増やさないエラーへ変換する", async ({ type, status, reason }) => {
    getCompatibilityInvitationContents.mockResolvedValue({ type });

    const response = await invitationRequest();

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Compatibility invitation unavailable",
      reason,
    });
  });

  it("CompatibilityData bindingがなければlogicを呼ばず503を返す", async () => {
    const response = await invitationRequest({ COMPATIBILITY_DATA: undefined });

    expect(response.status).toBe(503);
    expect(getCompatibilityInvitationContents).not.toHaveBeenCalled();
  });
});
