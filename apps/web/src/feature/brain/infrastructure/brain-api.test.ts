import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDevelopmentBrainItems } from "./brain-api";

describe("fetchDevelopmentBrainItems", () => {
  afterEach(() => vi.restoreAllMocks());

  it("本人のBrain Item一覧をBearer token付きで取得する", async () => {
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
              evidence: [],
            },
          ],
          truncated: false,
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchDevelopmentBrainItems("https://api.example.com", "id-token"),
    ).resolves.toMatchObject({ items: [{ id: "brain-1" }], truncated: false });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/dev/brain-items", {
      headers: { Authorization: "Bearer id-token" },
    });
  });

  it("production相当の404を利用不可として扱う", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    await expect(fetchDevelopmentBrainItems(undefined, "id-token")).rejects.toThrow(
      "この環境では利用できません",
    );
  });
});
