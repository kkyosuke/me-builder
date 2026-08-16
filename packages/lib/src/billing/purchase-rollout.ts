export const activePurchaseRolloutStages = ["operators", "invited", "public"] as const;
export type ActivePurchaseRolloutStage = (typeof activePurchaseRolloutStages)[number];
export type PurchaseRolloutStage = "stopped" | ActivePurchaseRolloutStage;

export type PurchaseRolloutState = Readonly<{
  stage: PurchaseRolloutStage;
  resumeStage: ActivePurchaseRolloutStage | null;
  changedAt: string;
}>;

export type NewPurchaseDecision = Readonly<{
  allowed: boolean;
  reason: "eligible" | "new-purchases-paused" | "operator-only" | "invitation-required";
}>;

function isActiveStage(value: unknown): value is ActivePurchaseRolloutStage {
  return activePurchaseRolloutStages.includes(value as ActivePurchaseRolloutStage);
}

function assertPurchaseRolloutState(state: PurchaseRolloutState): void {
  if (state.stage !== "stopped" && !isActiveStage(state.stage)) {
    throw new Error("Invalid purchase rollout stage");
  }
  if (state.resumeStage !== null && !isActiveStage(state.resumeStage)) {
    throw new Error("Invalid purchase rollout resume stage");
  }
  if (state.stage !== "stopped" && state.resumeStage !== null) {
    throw new Error("Active purchase rollout must not have a resume stage");
  }
  if (!Number.isFinite(Date.parse(state.changedAt))) {
    throw new Error("Invalid purchase rollout changedAt");
  }
}

export function initialPurchaseRolloutState(at = new Date()): PurchaseRolloutState {
  return Object.freeze({ stage: "stopped", resumeStage: null, changedAt: at.toISOString() });
}

/** 対象拡大は運営→招待→一般の隣接段階だけを許し、縮小と全停止は常に許す。 */
export function changePurchaseRolloutStage(
  current: PurchaseRolloutState,
  target: ActivePurchaseRolloutStage,
  at = new Date(),
): PurchaseRolloutState {
  assertPurchaseRolloutState(current);
  if (!isActiveStage(target)) throw new Error("Invalid purchase rollout target stage");
  if (current.stage === "stopped") {
    if (target !== "operators") throw new Error("Purchase rollout must start with operators");
  } else {
    const currentIndex = activePurchaseRolloutStages.indexOf(current.stage);
    const targetIndex = activePurchaseRolloutStages.indexOf(target);
    if (targetIndex > currentIndex + 1) {
      throw new Error("Purchase rollout can only expand by one stage");
    }
  }
  return Object.freeze({ stage: target, resumeStage: null, changedAt: at.toISOString() });
}

/** 新規購入だけを止め、復旧時に戻す公開段階を保持する。 */
export function stopNewPurchases(
  current: PurchaseRolloutState,
  at = new Date(),
): PurchaseRolloutState {
  assertPurchaseRolloutState(current);
  if (current.stage === "stopped") return current;
  return Object.freeze({
    stage: "stopped",
    resumeStage: current.stage,
    changedAt: at.toISOString(),
  });
}

export function resumeNewPurchases(
  current: PurchaseRolloutState,
  at = new Date(),
): PurchaseRolloutState {
  assertPurchaseRolloutState(current);
  if (current.stage !== "stopped") return current;
  if (current.resumeStage === null) throw new Error("Purchase rollout has no stage to resume");
  return Object.freeze({
    stage: current.resumeStage,
    resumeStage: null,
    changedAt: at.toISOString(),
  });
}

export function decideNewPurchase(
  state: PurchaseRolloutState,
  audience: Readonly<{ isOperator: boolean; isInvited: boolean }>,
): NewPurchaseDecision {
  assertPurchaseRolloutState(state);
  if (state.stage === "stopped") {
    return Object.freeze({ allowed: false, reason: "new-purchases-paused" });
  }
  if (state.stage === "operators" && !audience.isOperator) {
    return Object.freeze({ allowed: false, reason: "operator-only" });
  }
  if (state.stage === "invited" && !audience.isOperator && !audience.isInvited) {
    return Object.freeze({ allowed: false, reason: "invitation-required" });
  }
  return Object.freeze({ allowed: true, reason: "eligible" });
}

export const priceValidationWindows = [30, 90] as const;
export type PriceValidationWindowDays = (typeof priceValidationWindows)[number];

export type PriceValidationCounts = Readonly<{
  windowDays: PriceValidationWindowDays;
  startingPaidAccounts: number;
  retainedPaidAccounts: number;
  planChangeCount: number;
  renewalAttemptCount: number;
  paymentFailureCount: number;
  aiVariableCostUsd: number;
  paidAccountCount: number;
  feedbackCount: number;
  negativeFeedbackCount: number;
}>;

export type PriceValidationMetrics = Readonly<{
  windowDays: PriceValidationWindowDays;
  paidRetentionRate: number | null;
  planChangesPerStartingAccount: number | null;
  paymentFailureRate: number | null;
  aiVariableCostUsdPerPaidAccount: number | null;
  negativeFeedbackRate: number | null;
}>;

/** 個人内容やAccount IDを含まない集計値だけから価格検証指標を計算する。 */
export function calculatePriceValidationMetrics(
  counts: PriceValidationCounts,
): PriceValidationMetrics {
  if (!priceValidationWindows.includes(counts.windowDays)) {
    throw new Error("windowDays must be 30 or 90");
  }
  for (const [name, value] of Object.entries(counts)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
  }
  const countFields = [
    "startingPaidAccounts",
    "retainedPaidAccounts",
    "planChangeCount",
    "renewalAttemptCount",
    "paymentFailureCount",
    "paidAccountCount",
    "feedbackCount",
    "negativeFeedbackCount",
  ] as const;
  for (const field of countFields) {
    if (!Number.isSafeInteger(counts[field])) throw new Error(`${field} must be a whole number`);
  }
  if (counts.retainedPaidAccounts > counts.startingPaidAccounts) {
    throw new Error("retainedPaidAccounts must not exceed startingPaidAccounts");
  }
  if (counts.paymentFailureCount > counts.renewalAttemptCount) {
    throw new Error("paymentFailureCount must not exceed renewalAttemptCount");
  }
  if (counts.negativeFeedbackCount > counts.feedbackCount) {
    throw new Error("negativeFeedbackCount must not exceed feedbackCount");
  }
  return Object.freeze({
    windowDays: counts.windowDays,
    paidRetentionRate: ratio(counts.retainedPaidAccounts, counts.startingPaidAccounts),
    planChangesPerStartingAccount: ratio(counts.planChangeCount, counts.startingPaidAccounts),
    paymentFailureRate: ratio(counts.paymentFailureCount, counts.renewalAttemptCount),
    aiVariableCostUsdPerPaidAccount: ratio(counts.aiVariableCostUsd, counts.paidAccountCount),
    negativeFeedbackRate: ratio(counts.negativeFeedbackCount, counts.feedbackCount),
  });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
