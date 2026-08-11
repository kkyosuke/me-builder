import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfileSummary } from "./profile-api";

describe("fetchProfileSummary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("本人のまとめと次の行動を取得する", async () => {
    const summary = {
      generatedAt: "2026-08-08T12:00:00.000Z",
      headline: "まとめ",
      insights: [],
      recordCount: 1,
      diagnosisCount: 1,
      diaryCount: 0,
      latestRecordedAt: "2026-08-08T11:00:00.000Z",
    };
    const apiResponse = {
      versions: [
        {
          id: "version-1",
          sequence: 1,
          generatedAt: summary.generatedAt,
          isLatest: true,
          generationMethod: "ai",
          summary,
        },
      ],
      availableDataCounts: { diagnosis: 2, diary: 3 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
      nextAction: "chat",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProfileSummary("https://api.example.com", "id-token");

    expect(result).toEqual({
      ...apiResponse,
      generation: { status: "idle", canRegenerate: false, reasons: [] },
      summary,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/profile-summary",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("不正なレスポンスを受け入れない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            versions: [],
            availableDataCounts: { diagnosis: 0, diary: 0 },
            generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
            nextAction: "unknown",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchProfileSummary(undefined, "id-token")).rejects.toThrow();
  });

  it("認証失敗を利用者向けメッセージへ変換する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(fetchProfileSummary(undefined, "id-token")).rejects.toThrow(
      "本人確認に失敗しました",
    );
  });
});
