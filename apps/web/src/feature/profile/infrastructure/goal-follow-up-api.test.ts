import { afterEach, describe, expect, it, vi } from "vitest";
import { agreeGoalFollowUp, fetchGoalFollowUps, updateGoalFollowUp } from "./goal-follow-up-api";

const item = {
  id: "follow-1",
  brainItemId: "goal-1",
  goal: "面談で希望を伝える",
  nextStep: "希望を一つ書く",
  status: "active",
  agreedAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
} as const;

afterEach(() => vi.unstubAllGlobals());

describe("goal follow-up API", () => {
  it("候補と保存済みフォローアップを取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [item],
          candidates: [{ brainItemId: "goal-2", goal: "週末に歩く" }],
          canManage: true,
          activeLimit: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchGoalFollowUps("https://api.example.com")).resolves.toMatchObject({
      items: [item],
      candidates: [{ brainItemId: "goal-2" }],
    });
  });

  it("合意と更新を認証済みmutationとして送る", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ item }))));
    vi.stubGlobal("fetch", fetchMock);
    await agreeGoalFollowUp("https://api.example.com", {
      brainItemId: "goal-1",
      nextStep: "希望を一つ書く",
    });
    await updateGoalFollowUp("https://api.example.com", "follow/1", { status: "completed" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/goal-follow-ups",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/api/goal-follow-ups/follow%2F1",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });
});
