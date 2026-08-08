import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfileSummary } from "./profile-api";

describe("fetchProfileSummary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("本人のまとめと次の行動を取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ summary: null, nextAction: "chat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProfileSummary("https://api.example.com", "id-token");

    expect(result).toEqual({ summary: null, nextAction: "chat" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/profile-summary",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("不正なレスポンスを受け入れない", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ summary: null, nextAction: "unknown" }), { status: 200 }),
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
