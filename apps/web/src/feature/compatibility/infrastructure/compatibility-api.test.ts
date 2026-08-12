import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptCompatibilityInvitation,
  cancelCompatibilityInvitation,
  endCompatibilityRelationship,
  fetchCompatibilityInvitation,
  fetchCompatibilityRelationship,
  fetchCompatibilityRelationships,
  fetchCompatibilityShareConsent,
  issueCompatibilityInvitation,
} from "./compatibility-api";

const consent = {
  displayName: "うさぎ",
  avatarUrl: "/api/profile/avatar",
  canShare: true,
  blockingReasons: [],
  nextAction: null,
};

const shareContent = {
  aboutMe: {
    profileSummaryVersionId: "summary-version-1",
    generatedAt: "2026-08-11T00:00:00.000Z",
    statements: [
      {
        key: "planning-style",
        label: "予定の立て方",
        statement: "私は、先の見通しを持って動けると安心しやすいです",
      },
    ],
  },
  themes: [
    {
      diagnosisId: "daily-life",
      title: "暮らし方",
      parameters: [
        {
          id: "planning",
          label: "予定の立て方",
          lowLabel: "その場で決めたい",
          highLabel: "早めに決めたい",
          position: 78,
          statement: "私は、予定を早めに決めておけると安心します。",
        },
      ],
    },
  ],
};

describe("fetchCompatibilityShareConsent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("認証付きで共有可否を取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(consent), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCompatibilityShareConsent("https://api.example.com", "id-token"),
    ).resolves.toEqual(consent);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/compatibility/share-consent",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("契約外の共有可否を受け入れない", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...consent, canShare: "yes" }), { status: 200 }),
        ),
    );

    await expect(fetchCompatibilityShareConsent(undefined, "id-token")).rejects.toThrow();
  });

  it("認証失敗を利用者向けメッセージへ変換する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(fetchCompatibilityShareConsent(undefined, "id-token")).rejects.toThrow(
      "本人確認に失敗しました",
    );
  });
});

describe("issueCompatibilityInvitation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("リクエスト本文を送らず、発行したURLを受け取る", async () => {
    const invitation = {
      invitationUrl: `https://example.com/compatibility/invitations/${"1".repeat(64)}`,
      expiresAt: "2026-08-26T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(invitation, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      issueCompatibilityInvitation("https://api.example.com", "id-token"),
    ).resolves.toEqual(invitation);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/compatibility/invitations",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer id-token" } }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("共有を開始できない競合を利用者向けメッセージへ変換する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));

    await expect(issueCompatibilityInvitation(undefined, "id-token")).rejects.toThrow(
      "いまは共有を始められません",
    );
  });
});

describe("fetchCompatibilityInvitation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("認証付きで関係IDの招待内容を取得する", async () => {
    const relationshipId = "1".repeat(64);
    const invitation = {
      inviter: {
        displayName: "あおい",
        avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
      },
      recipient: { displayName: "はる", avatarUrl: "/api/profile/avatar" },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(invitation));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCompatibilityInvitation("https://api.example.com", "id-token", relationshipId),
    ).resolves.toEqual(invitation);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/compatibility/invitations/${relationshipId}`,
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it.each([
    [404, "この招待は利用できません"],
    [409, "自分が発行した招待は承諾できません"],
  ])("HTTP %sを利用者向けメッセージへ変換する", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    await expect(
      fetchCompatibilityInvitation(undefined, "id-token", "1".repeat(64)),
    ).rejects.toThrow(message);
  });

  it("Accountがなければ友だち追加を案内する", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Account not found", reason: "friendship_required" },
            { status: 404 },
          ),
        ),
    );

    await expect(
      fetchCompatibilityInvitation(undefined, "id-token", "1".repeat(64)),
    ).rejects.toThrow("LINE公式アカウントを友だち追加");
  });
});

describe("compatibility relationship APIs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("一覧から再送可能なLIFF URLを取得する", async () => {
    const relationshipId = "1".repeat(64);
    const data = {
      items: [
        {
          relationshipId,
          status: "pending",
          expiresAt: "2026-08-26T00:00:00.000Z",
          invitationUrl: `https://liff.line.me/test/compatibility/invitations/${relationshipId}`,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCompatibilityRelationships(undefined, "id-token")).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/compatibility/relationships",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("リクエスト本文なしで招待を承諾する", async () => {
    const relationshipId = "2".repeat(64);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ relationshipId, status: "accepted" }));
    vi.stubGlobal("fetch", fetchMock);

    await acceptCompatibilityInvitation(undefined, "id-token", relationshipId);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/compatibility/invitations/${relationshipId}/accept`,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer id-token" },
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("相手と自分の相性シートを取得する", async () => {
    const relationshipId = "3".repeat(64);
    const data = {
      relationshipId,
      status: "ready",
      partner: { displayName: "あおい", ...shareContent },
      viewer: { displayName: "はる", ...shareContent },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
    await expect(
      fetchCompatibilityRelationship(undefined, "id-token", relationshipId),
    ).resolves.toEqual(data);
  });

  it.each([
    ["invitation", cancelCompatibilityInvitation, "/api/compatibility/invitations/"],
    ["relationship", endCompatibilityRelationship, "/api/compatibility/relationships/"],
  ] as const)("DELETEで%sを終了する", async (_name, operation, prefix) => {
    const relationshipId = "4".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await operation(undefined, "id-token", relationshipId);
    expect(fetchMock).toHaveBeenCalledWith(
      `${prefix}${relationshipId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([
    [404, "この招待は利用できません"],
    [409, "この招待は承諾できません"],
    [401, "本人確認に失敗しました"],
  ])("承諾のHTTP %sを利用者向けメッセージへ変換する", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    await expect(
      acceptCompatibilityInvitation(undefined, "id-token", "5".repeat(64)),
    ).rejects.toThrow(message);
  });

  it.each([
    [404, "この相性シートは利用できません"],
    [401, "本人確認に失敗しました"],
  ])("相性シート取得のHTTP %sを利用者向けメッセージへ変換する", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    await expect(
      fetchCompatibilityRelationship(undefined, "id-token", "5".repeat(64)),
    ).rejects.toThrow(message);
  });

  it.each([
    ["invitation", cancelCompatibilityInvitation, "この招待はすでに取り消されたか"],
    ["relationship", endCompatibilityRelationship, "この共有はすでに終了しています"],
  ] as const)(
    "すでに終えた%sへのDELETEはHTTP状態コードを見せずに状況を伝える",
    async (_name, operation, message) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

      const failure = await operation(undefined, "id-token", "6".repeat(64)).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(message);
      expect((failure as Error).message).not.toContain("404");
    },
  );

  it.each([
    ["accept", () => acceptCompatibilityInvitation(undefined, "t", "7".repeat(64))],
    ["relationship", () => fetchCompatibilityRelationship(undefined, "t", "7".repeat(64))],
    ["cancel", () => cancelCompatibilityInvitation(undefined, "t", "7".repeat(64))],
    ["end", () => endCompatibilityRelationship(undefined, "t", "7".repeat(64))],
  ] as const)("%sでもAccountがなければ友だち追加を案内する", async (_name, operation) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Account not found", reason: "friendship_required" },
            { status: 404 },
          ),
        ),
    );

    await expect(operation()).rejects.toThrow("LINE公式アカウントを友だち追加");
  });
});
