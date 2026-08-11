import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCompatibilitySharePreview } from "./compatibility-api";

const preview = {
  displayName: "うさぎ",
  previewToken: `csp2.${"a".repeat(64)}`,
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
  canIssueInvitation: true,
  blockingReasons: [],
  nextAction: null,
};

describe("fetchCompatibilitySharePreview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("認証付きで共有プレビューを取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(preview), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCompatibilitySharePreview("https://api.example.com", "id-token"),
    ).resolves.toEqual(preview);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/compatibility/share-preview",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("契約外のプレビュートークンを受け入れない", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...preview, previewToken: "invalid" }), { status: 200 }),
        ),
    );

    await expect(fetchCompatibilitySharePreview(undefined, "id-token")).rejects.toThrow();
  });

  it("認証失敗を利用者向けメッセージへ変換する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(fetchCompatibilitySharePreview(undefined, "id-token")).rejects.toThrow(
      "本人確認に失敗しました",
    );
  });
});
