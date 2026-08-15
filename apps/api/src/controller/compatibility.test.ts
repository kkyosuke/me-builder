import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type {
  CompatibilityShareConsentOutcome,
  CompatibilityShareContentOutcome,
} from "../logic/compatibility-share-preview";

const { getCompatibilityShareConsent, getCompatibilityShareContent } = vi.hoisted(() => ({
  getCompatibilityShareConsent: vi.fn(),
  getCompatibilityShareContent: vi.fn(),
}));
const { issueCompatibilityInvitation } = vi.hoisted(() => ({
  issueCompatibilityInvitation: vi.fn(),
}));
const { getCompatibilityInvitationContents } = vi.hoisted(() => ({
  getCompatibilityInvitationContents: vi.fn(),
}));
const { getCompatibilityInvitationAvatar } = vi.hoisted(() => ({
  getCompatibilityInvitationAvatar: vi.fn(),
}));
const { endCompatibilityRelationship } = vi.hoisted(() => ({
  endCompatibilityRelationship: vi.fn(),
}));
vi.mock("../logic/compatibility-share-preview", () => ({
  getCompatibilityShareConsent,
  getCompatibilityShareContent,
}));
vi.mock("../logic/compatibility-invitation", () => ({ issueCompatibilityInvitation }));
vi.mock("../logic/compatibility-invitation-preview", () => ({
  getCompatibilityInvitationContents,
}));
vi.mock("../logic/compatibility-invitation-avatar", () => ({
  getCompatibilityInvitationAvatar,
}));
vi.mock("../logic/compatibility-relationship-end", () => ({ endCompatibilityRelationship }));

const dummyDb = {} as D1Database;
const dummyAvatarBucket = {} as R2Bucket;
const dummyAccountData = {} as AccountDataNamespace;
const dummyCompatibilityData = {} as CompatibilityDataNamespace;

function outcome(value: CompatibilityShareConsentOutcome) {
  getCompatibilityShareConsent.mockResolvedValue(value);
}

function request(
  env: Record<string, unknown> = {},
  authorization = "Bearer dummy.id.token",
  relationshipCategory?: string,
) {
  const query = relationshipCategory
    ? `?relationshipCategory=${encodeURIComponent(relationshipCategory)}`
    : "";
  return app.request(
    `/api/compatibility/share-consent${query}`,
    { headers: { Authorization: authorization } },
    {
      LIFF_ID: "2010850319-Yl63upAR",
      DB: dummyDb,
      ACCOUNT_DATA: dummyAccountData,
      ...env,
    },
  );
}

describe("GET /api/compatibility/share-consent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolvedを200の共有可否へ変換する", async () => {
    outcome({
      type: "resolved",
      consent: {
        displayName: "あおい",
        avatarUrl: "/api/profile/avatar",
        canShare: true,
        blockingReasons: [],
        nextAction: "diagnosis",
      },
    });

    const response = await request(
      {
        AVATAR_BUCKET: dummyAvatarBucket,
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
      },
      "Bearer dummy.id.token",
      "family",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      displayName: "あおい",
      avatarUrl: "/api/profile/avatar",
      canShare: true,
      blockingReasons: [],
      nextAction: "diagnosis",
    });
    expect(getCompatibilityShareConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "dummy.id.token",
        lineLoginChannelId: "2010850319",
        accountData: dummyAccountData,
        relationshipCategory: "family",
      }),
    );
  });

  it.each(["general", "other"])('関係カテゴリ"%s"を400で拒否する', async (category) => {
    const response = await request({}, "Bearer dummy.id.token", category);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(getCompatibilityShareConsent).not.toHaveBeenCalled();
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

    expect(getCompatibilityShareConsent).toHaveBeenCalledWith(
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
      "/api/compatibility/share-consent",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID: "2010850319-Yl63upAR" },
    );

    expect(response.status).toBe(503);
    expect(getCompatibilityShareConsent).not.toHaveBeenCalled();
  });
});

describe("GET /api/compatibility/share-content", () => {
  beforeEach(() => vi.clearAllMocks());

  function contentRequest(category?: string, env: Record<string, unknown> = {}) {
    const query = category ? `?relationshipCategory=${encodeURIComponent(category)}` : "";
    return app.request(
      `/api/compatibility/share-content${query}`,
      { headers: { Authorization: "Bearer dummy.id.token" } },
      {
        LIFF_ID: "2010850319-Yl63upAR",
        DB: dummyDb,
        ACCOUNT_DATA: dummyAccountData,
        ...env,
      },
    );
  }

  function contentOutcome(value: CompatibilityShareContentOutcome) {
    getCompatibilityShareContent.mockResolvedValue(value);
  }

  it("resolvedを200の共有内容へ変換する", async () => {
    contentOutcome({
      type: "resolved",
      content: {
        relationshipCategory: "partner",
        aboutMe: null,
        themes: [],
        nextAction: "profile-summary",
      },
    });

    const response = await contentRequest("partner");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      relationshipCategory: "partner",
      aboutMe: null,
      themes: [],
      nextAction: "profile-summary",
    });
    expect(getCompatibilityShareContent).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "dummy.id.token",
        lineLoginChannelId: "2010850319",
        accountData: dummyAccountData,
        relationshipCategory: "partner",
      }),
    );
  });

  it.each([undefined, "general", "other"])('関係カテゴリ"%s"を400で拒否する', async (category) => {
    const response = await contentRequest(category);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(getCompatibilityShareContent).not.toHaveBeenCalled();
  });

  it("Accountがなければ404を返す", async () => {
    contentOutcome({ type: "account-not-found" });

    const response = await contentRequest("friend");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
  });

  it("storage bindingがなければlogicを呼ばず503を返す", async () => {
    const response = await app.request(
      "/api/compatibility/share-content?relationshipCategory=work",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID: "2010850319-Yl63upAR" },
    );

    expect(response.status).toBe(503);
    expect(getCompatibilityShareContent).not.toHaveBeenCalled();
  });
});

describe("POST /api/compatibility/invitations", () => {
  beforeEach(() => vi.clearAllMocks());

  function issueRequest(
    env: Record<string, unknown> = {},
    body: unknown = { relationshipCategory: "partner" },
  ) {
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
      relationshipCategory: "partner",
    });

    const response = await issueRequest();

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      invitationUrl: `https://liff.line.me/2010850319-Yl63upAR/compatibility/invitations/${"1".repeat(64)}`,
      expiresAt: "2026-08-26T00:00:00.000Z",
      relationshipCategory: "partner",
    });
    expect(issueCompatibilityInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "dummy.id.token",
        liff: {
          liffId: "2010850319-Yl63upAR",
          lineLoginChannelId: "2010850319",
        },
        accountData: dummyAccountData,
        compatibilityData: dummyCompatibilityData,
        relationshipCategory: "partner",
      }),
    );
  });

  it.each([
    {},
    { relationshipCategory: "general" },
    { relationshipCategory: "other" },
    { relationshipCategory: null },
  ])("関係カテゴリが未選択または対象外なら400で拒否する", async (body) => {
    const response = await issueRequest({}, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });

  it("share-unavailableを409へ変換する", async () => {
    issueCompatibilityInvitation.mockResolvedValue({ type: "share-unavailable" });
    const response = await issueRequest();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Compatibility invitation unavailable",
      reason: "share_unavailable",
    });
  });

  it("CompatibilityData bindingがなければ503を返す", async () => {
    const response = await issueRequest({ COMPATIBILITY_DATA: undefined });

    expect(response.status).toBe(503);
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });

  it("LIFF_IDがなければ招待を作成せず503を返す", async () => {
    const response = await issueRequest({ LIFF_ID: undefined });

    expect(response.status).toBe(503);
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });

  it.each([
    { LIFF_ID: "invalid" },
    { LIFF_ID: "2010850319-Yl63upAR", LINE_LOGIN_CHANNEL_ID: "9999999999" },
  ])("不正なLIFF設定を招待作成前に500で拒否する", async (env) => {
    const response = await issueRequest(env);
    expect(response.status).toBe(500);
    expect(issueCompatibilityInvitation).not.toHaveBeenCalled();
  });
});

describe("GET /api/compatibility/invitations/:relationshipId", () => {
  beforeEach(() => vi.clearAllMocks());

  const relationshipId = "1".repeat(64);
  const invitation = {
    relationshipCategory: "family",
    inviter: {
      displayName: "あおい",
      avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
    },
    recipient: { displayName: "はる", avatarUrl: "/api/profile/avatar" },
    expiresAt: "2026-08-26T00:00:00.000Z",
    canAccept: true,
    blockingReasons: [],
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

    const response = await invitationRequest({
      AVATAR_BUCKET: dummyAvatarBucket,
      LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    });

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

describe("GET /api/compatibility/invitations/:relationshipId/avatar", () => {
  beforeEach(() => vi.clearAllMocks());

  const relationshipId = "1".repeat(64);
  const requestAvatar = (env: Record<string, unknown> = {}) =>
    app.request(
      `/api/compatibility/invitations/${relationshipId}/avatar`,
      { headers: { Authorization: "Bearer dummy.id.token" } },
      {
        LIFF_ID: "2010850319-Yl63upAR",
        DB: dummyDb,
        AVATAR_BUCKET: dummyAvatarBucket,
        COMPATIBILITY_DATA: dummyCompatibilityData,
        ...env,
      },
    );

  it("認可済み画像をno-storeの画像bodyへ変換する", async () => {
    getCompatibilityInvitationAvatar.mockResolvedValue({
      type: "resolved",
      image: { bytes: Uint8Array.from([1, 2, 3]), contentType: "image/png" },
    });

    const response = await requestAvatar({ LINE_CHANNEL_ACCESS_TOKEN: "line-token" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
    expect(getCompatibilityInvitationAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        relationshipId,
        idToken: "dummy.id.token",
        avatarBucket: dummyAvatarBucket,
        lineChannelAccessToken: "line-token",
      }),
    );
  });

  it("画像がなければ204、自分の招待なら409を返す", async () => {
    getCompatibilityInvitationAvatar.mockResolvedValueOnce({ type: "image-unavailable" });
    expect((await requestAvatar()).status).toBe(204);

    getCompatibilityInvitationAvatar.mockResolvedValueOnce({ type: "own-invitation" });
    expect((await requestAvatar()).status).toBe(409);
  });

  it("Private R2 bindingがなければlogicを呼ばず503を返す", async () => {
    const response = await requestAvatar({ AVATAR_BUCKET: undefined });
    expect(response.status).toBe(503);
    expect(getCompatibilityInvitationAvatar).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/compatibility/relationships/:relationshipId", () => {
  beforeEach(() => vi.clearAllMocks());
  const relationshipId = "1".repeat(64);

  function endRequest(env: Record<string, unknown> = {}, authorization = "Bearer dummy.id.token") {
    return app.request(
      `/api/compatibility/relationships/${relationshipId}`,
      { method: "DELETE", headers: { Authorization: authorization } },
      {
        LIFF_ID: "2010850319-Yl63upAR",
        DB: dummyDb,
        ACCOUNT_DATA: dummyAccountData,
        COMPATIBILITY_DATA: dummyCompatibilityData,
        ...env,
      },
    );
  }

  it("endedをno-storeの204へ変換する", async () => {
    endCompatibilityRelationship.mockResolvedValue({ type: "ended" });
    const response = await endRequest();
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(endCompatibilityRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        relationshipId,
        idToken: "dummy.id.token",
        accountData: dummyAccountData,
        compatibilityData: dummyCompatibilityData,
      }),
    );
  });

  it("unavailableを404へ変換する", async () => {
    endCompatibilityRelationship.mockResolvedValue({ type: "unavailable" });
    const response = await endRequest();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Compatibility relationship unavailable",
      reason: "relationship_unavailable",
    });
  });

  it.each([
    { outcome: { type: "not-configured" }, status: 401, body: { error: "Unauthorized" } },
    {
      outcome: { type: "unauthenticated", reason: "invalid" },
      status: 401,
      body: { error: "Unauthorized" },
    },
    {
      outcome: { type: "account-not-found" },
      status: 404,
      body: { error: "Account not found", reason: "friendship_required" },
    },
  ])("認証結果をHTTPへ変換する", async ({ outcome, status, body }) => {
    endCompatibilityRelationship.mockResolvedValue(outcome);
    const response = await endRequest();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it.each(["DB", "ACCOUNT_DATA", "COMPATIBILITY_DATA"])(
    "%s bindingがなければlogicを呼ばず503を返す",
    async (binding) => {
      const response = await endRequest({ [binding]: undefined });
      expect(response.status).toBe(503);
      expect(endCompatibilityRelationship).not.toHaveBeenCalled();
    },
  );

  it("Bearer形式でない認証情報をIDトークンとして渡さない", async () => {
    endCompatibilityRelationship.mockResolvedValue({ type: "unauthenticated", reason: "missing" });
    await endRequest({}, "Basic credentials");
    expect(endCompatibilityRelationship).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: undefined }),
    );
  });
});
