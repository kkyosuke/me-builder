import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfileProgression } from "./progression-api";

describe("fetchProfileProgression", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("認証付きで本人の進行度を取得する", async () => {
    const progression = {
      level: 2,
      growthValue: 7,
      currentLevelThreshold: 5,
      nextLevelThreshold: 20,
      collectedPieces: 2,
      activePieces: 2,
      categoryCount: 2,
      calculationVersion: 1,
      highestLevel: 2,
      recentChanges: [
        {
          kind: "new_piece" as const,
          growthDelta: 3,
          occurredAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(progression));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProfileProgression("https://api.example.com", "id-token")).resolves.toEqual(
      progression,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/profile/progression",
      expect.objectContaining({ headers: { Authorization: "Bearer id-token" } }),
    );
  });

  it("負数や不完全な応答を受け入れない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          level: 1,
          growthValue: -1,
          currentLevelThreshold: 0,
          nextLevelThreshold: 5,
          collectedPieces: 0,
          activePieces: 0,
          categoryCount: 0,
          calculationVersion: 1,
          highestLevel: 1,
          recentChanges: [],
        }),
      ),
    );

    await expect(fetchProfileProgression(undefined, "id-token")).rejects.toThrow();
  });
});
