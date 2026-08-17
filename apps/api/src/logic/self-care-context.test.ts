import { type AccountDataNamespace, type D1, billing } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSelfCareContext, getSelfCareContexts } from "./self-care-context";

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

describe("self-care context entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Freeは確認済み結果を読めるが新しい確認を作らない", async () => {
    execute.mockResolvedValueOnce({ items: [{ id: "archived", status: "revoked" }] });
    await expect(
      getSelfCareContexts({ ...common, planAssignmentProvider: provider("free") }),
    ).resolves.toMatchObject({ type: "resolved", canManage: false });
    await expect(
      confirmSelfCareContext({
        ...common,
        brainItemId: "brain-1",
        kind: "worked",
        planAssignmentProvider: provider("free"),
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "feature_unavailable" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(["lite", "full"] as const)("%sは本人の確認をAccountDataへ保存する", async (plan) => {
    execute.mockResolvedValueOnce({ type: "confirmed", item: { id: "self-care-1" } });
    await expect(
      confirmSelfCareContext({
        ...common,
        brainItemId: "brain-1",
        kind: "did-not-work",
        planAssignmentProvider: provider(plan),
      }),
    ).resolves.toMatchObject({ type: "resolved", result: { type: "confirmed" } });
    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "selfCareContext.confirm",
      "brain-1",
      "did-not-work",
      at,
    );
  });
});
