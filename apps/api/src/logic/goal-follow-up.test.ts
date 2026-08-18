import { type AccountDataNamespace, type D1, billing } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agreeGoalFollowUp, getGoalFollowUps, updateGoalFollowUp } from "./goal-follow-up";

const execute = vi.fn();
const accountData = { getByName: vi.fn(() => ({ execute })) } as unknown as AccountDataNamespace;
const at = new Date("2026-08-16T00:00:00.000Z");
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: at,
};

function provider(plan: "free" | "lite" | "full") {
  return new billing.FakeAccountPlanAssignmentProvider([
    {
      accountId: "account-1",
      plan,
      source: plan === "free" ? "free" : "subscription",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      availableUntil: null,
      payerAccountId: plan === "free" ? null : "account-1",
    },
  ]);
}

const common = {
  actor,
  db: {} as D1.shared.Client,
  accountData,
  at,
};

describe("goal follow-up entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Freeは保存済み状態を読めるが、新しい合意は作らない", async () => {
    execute.mockResolvedValueOnce({
      items: [{ id: "archived", status: "completed" }],
      candidates: [],
    });
    await expect(
      getGoalFollowUps({ ...common, planAssignmentProvider: provider("free") }),
    ).resolves.toMatchObject({ type: "resolved", canManage: false, activeLimit: null });
    await expect(
      agreeGoalFollowUp({
        ...common,
        brainItemId: "goal-1",
        nextStep: "一行書く",
        planAssignmentProvider: provider("free"),
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "feature_unavailable" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("account-1", "goalFollowUp.read", at);
  });

  it("Liteは同時に1件だけを本人の合意対象にする", async () => {
    execute.mockResolvedValue({ type: "active-limit-reached" });
    await expect(
      agreeGoalFollowUp({
        ...common,
        brainItemId: "goal-2",
        nextStep: "靴を出す",
        planAssignmentProvider: provider("lite"),
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "active_limit" });
    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "goalFollowUp.agree",
      "goal-2",
      "靴を出す",
      at,
      1,
    );
  });

  it("Fullは複数の合意と本人による完了・訂正をAccountDataへ委譲する", async () => {
    execute
      .mockResolvedValueOnce({ type: "agreed", item: { id: "follow-2", status: "active" } })
      .mockResolvedValueOnce({
        type: "updated",
        item: { id: "follow-2", status: "completed", nextStep: "二行書く" },
      });
    await expect(
      agreeGoalFollowUp({
        ...common,
        brainItemId: "goal-2",
        nextStep: "一行書く",
        planAssignmentProvider: provider("full"),
      }),
    ).resolves.toMatchObject({ type: "resolved", result: { type: "agreed" } });
    await expect(
      updateGoalFollowUp({
        ...common,
        id: "follow-2",
        input: { status: "completed", nextStep: "二行書く" },
        planAssignmentProvider: provider("full"),
      }),
    ).resolves.toMatchObject({ type: "resolved", result: { type: "updated" } });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      "account-1",
      "goalFollowUp.agree",
      "goal-2",
      "一行書く",
      at,
      null,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "account-1",
      "goalFollowUp.update",
      "follow-2",
      { status: "completed", nextStep: "二行書く" },
      at,
      null,
    );
  });
});
