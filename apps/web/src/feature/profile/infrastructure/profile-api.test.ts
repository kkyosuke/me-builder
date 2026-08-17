import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileSummaryGenerationUnavailableError } from "../model/profile-summary";
import { fetchProfileSummary, requestProfileSummaryGeneration } from "./profile-api";

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
      diagnosisThemes: [],
      nextAction: "chat",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProfileSummary("https://api.example.com");

    expect(result).toEqual({
      ...apiResponse,
      generation: { status: "idle", canRegenerate: false, reasons: [] },
      summary,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/profile-summary",
      expect.objectContaining({ credentials: "include" }),
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

    await expect(fetchProfileSummary(undefined)).rejects.toThrow();
  });

  it("認証失敗を利用者向けメッセージへ変換する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(fetchProfileSummary(undefined)).rejects.toThrow("本人確認に失敗しました");
  });

  it("新しいまとめ版の生成を要求する", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { generationId: "generation-1", status: "queued", created: true },
            { status: 202 },
          ),
        ),
    );

    await expect(requestProfileSummaryGeneration("https://api.example.com")).resolves.toEqual({
      generationId: "generation-1",
      status: "queued",
      created: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/profile-summary/generations",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it.each([
    ["source_record_required", "まとめに使える記録がまだありません。"],
    ["regeneration_not_required", "新しい情報がないため、再生成は必要ありません。"],
  ] as const)("生成できない理由 %s を区別する", async (reason, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Profile summary generation unavailable", reason },
            { status: 409 },
          ),
        ),
    );

    const request = requestProfileSummaryGeneration(undefined);

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ProfileSummaryGenerationUnavailableError>>({
        reason,
        message,
      }),
    );
  });
});
