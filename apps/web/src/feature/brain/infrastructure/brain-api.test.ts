import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDevelopmentBrainItems, fetchDevelopmentBrainVector } from "./brain-api";

describe("fetchDevelopmentBrainItems", () => {
  afterEach(() => vi.restoreAllMocks());

  it("本人のBrain Item一覧をapplication sessionで取得する", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "brain-1",
              category: "memory",
              statement: "公園を散歩した",
              derivation: "ai",
              status: "active",
              createdAt: "2026-08-09T00:00:00.000Z",
              firstObservedAt: "2026-08-01T00:00:00.000Z",
              lastObservedAt: "2026-08-09T00:00:00.000Z",
              vectorSync: {
                status: "applied",
                operation: "upsert",
                attemptCount: 1,
                updatedAt: "2026-08-09T00:01:00.000Z",
                hasEntry: true,
                entryRevision: 1,
              },
              evidence: [],
            },
          ],
          truncated: false,
        }),
        { status: 200 },
      ),
    );

    await expect(fetchDevelopmentBrainItems("https://api.example.com")).resolves.toMatchObject({
      items: [{ id: "brain-1" }],
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/dev/brain-items", {
      credentials: "include",
    });
  });

  it("production相当の404を利用不可として扱う", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    await expect(fetchDevelopmentBrainItems(undefined)).rejects.toThrow(
      "この環境では利用できません",
    );
  });

  it("本人のBrain Itemに対応するVectorize実体を確認する", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          state: "present",
          entryRevision: 12,
          dimensions: 768,
          metadata: { category: "memory", derivation: "ai", embeddingVersion: 1 },
          checkedAt: "2026-08-10T00:00:00.000Z",
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchDevelopmentBrainVector("https://api.example.com", "brain/item"),
    ).resolves.toMatchObject({ state: "present", dimensions: 768 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/dev/brain-items/brain%2Fitem/vector",
      { credentials: "include" },
    );
  });
});
