import { describe, expect, it } from "vitest";
import { FakeAccountPlanAssignmentProvider } from "./account-plan-assignment";
import { EntitlementService } from "./entitlement";
import {
  calculatePriceValidationMetrics,
  changePurchaseRolloutStage,
  decideNewPurchase,
  initialPurchaseRolloutState,
  resumeNewPurchases,
  stopNewPurchases,
} from "./purchase-rollout";

const at = (iso: string) => new Date(iso);

describe("purchase rollout", () => {
  it("運営→招待→一般の順にだけ拡大し、各段階の新規購入対象を制限する", () => {
    const stopped = initialPurchaseRolloutState(at("2026-08-16T00:00:00.000Z"));
    expect(decideNewPurchase(stopped, { isOperator: true, isInvited: true })).toEqual({
      allowed: false,
      reason: "new-purchases-paused",
    });
    expect(() => changePurchaseRolloutStage(stopped, "invited")).toThrow(
      "must start with operators",
    );

    const operators = changePurchaseRolloutStage(
      stopped,
      "operators",
      at("2026-08-16T01:00:00.000Z"),
    );
    expect(decideNewPurchase(operators, { isOperator: true, isInvited: false }).allowed).toBe(true);
    expect(decideNewPurchase(operators, { isOperator: false, isInvited: true })).toEqual({
      allowed: false,
      reason: "operator-only",
    });
    expect(() => changePurchaseRolloutStage(operators, "public")).toThrow(
      "only expand by one stage",
    );

    const invited = changePurchaseRolloutStage(operators, "invited");
    expect(decideNewPurchase(invited, { isOperator: false, isInvited: true }).allowed).toBe(true);
    expect(decideNewPurchase(invited, { isOperator: false, isInvited: false })).toEqual({
      allowed: false,
      reason: "invitation-required",
    });
    const publicStage = changePurchaseRolloutStage(invited, "public");
    expect(decideNewPurchase(publicStage, { isOperator: false, isInvited: false }).allowed).toBe(
      true,
    );
  });

  it("緊急停止後は同じ段階へ再開し、既存契約のEntitlementには影響しない", async () => {
    const operators = changePurchaseRolloutStage(initialPurchaseRolloutState(), "operators");
    const invited = changePurchaseRolloutStage(operators, "invited");
    const stopped = stopNewPurchases(invited, at("2026-08-16T02:00:00.000Z"));
    expect(stopped).toMatchObject({ stage: "stopped", resumeStage: "invited" });
    expect(stopNewPurchases(stopped)).toBe(stopped);
    expect(decideNewPurchase(stopped, { isOperator: true, isInvited: true }).allowed).toBe(false);

    const provider = new FakeAccountPlanAssignmentProvider([
      {
        accountId: "existing-account",
        plan: "full",
        source: "subscription",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        availableUntil: null,
        payerAccountId: "existing-account",
      },
    ]);
    await expect(
      new EntitlementService(provider).resolve("existing-account", at("2026-08-16T02:00:00.000Z")),
    ).resolves.toMatchObject({ plan: "full", source: "subscription" });

    expect(resumeNewPurchases(stopped, at("2026-08-16T03:00:00.000Z"))).toMatchObject({
      stage: "invited",
      resumeStage: null,
    });
    expect(() => resumeNewPurchases(initialPurchaseRolloutState())).toThrow("no stage to resume");
  });

  it("永続化された不正な段階状態を購入許可へ倒さない", () => {
    const invalid = {
      ...initialPurchaseRolloutState(),
      stage: "unknown",
    } as unknown as ReturnType<typeof initialPurchaseRolloutState>;
    expect(() => decideNewPurchase(invalid, { isOperator: true, isInvited: true })).toThrow(
      "Invalid purchase rollout stage",
    );
    expect(() =>
      changePurchaseRolloutStage(
        initialPurchaseRolloutState(),
        "unknown" as Parameters<typeof changePurchaseRolloutStage>[1],
      ),
    ).toThrow("Invalid purchase rollout target stage");
  });

  it.each([30, 90] as const)("%d日価格検証指標を個人識別子なしで計算する", (windowDays) => {
    expect(
      calculatePriceValidationMetrics({
        windowDays,
        startingPaidAccounts: 20,
        retainedPaidAccounts: 16,
        planChangeCount: 3,
        renewalAttemptCount: 18,
        paymentFailureCount: 2,
        aiVariableCostUsd: 24,
        paidAccountCount: 16,
        feedbackCount: 10,
        negativeFeedbackCount: 1,
      }),
    ).toEqual({
      windowDays,
      paidRetentionRate: 0.8,
      planChangesPerStartingAccount: 0.15,
      paymentFailureRate: 2 / 18,
      aiVariableCostUsdPerPaidAccount: 1.5,
      negativeFeedbackRate: 0.1,
    });
  });

  it("母数0は推測せずnullとし、不整合な集計値を拒否する", () => {
    const empty = {
      windowDays: 30 as const,
      startingPaidAccounts: 0,
      retainedPaidAccounts: 0,
      planChangeCount: 0,
      renewalAttemptCount: 0,
      paymentFailureCount: 0,
      aiVariableCostUsd: 0,
      paidAccountCount: 0,
      feedbackCount: 0,
      negativeFeedbackCount: 0,
    };
    expect(calculatePriceValidationMetrics(empty)).toMatchObject({
      paidRetentionRate: null,
      paymentFailureRate: null,
      aiVariableCostUsdPerPaidAccount: null,
      negativeFeedbackRate: null,
    });
    expect(() =>
      calculatePriceValidationMetrics({ ...empty, renewalAttemptCount: 1, paymentFailureCount: 2 }),
    ).toThrow("must not exceed");
    expect(() =>
      calculatePriceValidationMetrics({
        ...empty,
        windowDays: 60 as Parameters<typeof calculatePriceValidationMetrics>[0]["windowDays"],
      }),
    ).toThrow("windowDays must be 30 or 90");
    expect(() => calculatePriceValidationMetrics({ ...empty, startingPaidAccounts: 0.5 })).toThrow(
      "startingPaidAccounts must be a whole number",
    );
  });
});
