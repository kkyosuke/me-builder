import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSelfCareContexts, revokeSelfCareContext } from "./self-care-context-api";

const item = {
  id: "self-care-1",
  brainItemId: "brain-1",
  statement: "予定を一つ減らすと少し楽になった",
  kind: "worked",
  status: "active",
  confirmedAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
} as const;

afterEach(() => vi.unstubAllGlobals());

describe("self-care context API", () => {
  it("確認済み情報を取得する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [item],
            canManage: true,
          }),
        ),
      ),
    );
    await expect(fetchSelfCareContexts("https://api.example.com")).resolves.toMatchObject({
      items: [item],
    });
  });

  it("撤回を認証済みmutationとして送る", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ item }))));
    vi.stubGlobal("fetch", fetchMock);
    await revokeSelfCareContext("https://api.example.com", "self/care-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/self-care/contexts/self%2Fcare-1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });
});
