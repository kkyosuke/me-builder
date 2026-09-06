export const planCodes = ["free", "lite", "full", "family"] as const;
export type PlanCode = (typeof planCodes)[number];

export const planAssignmentSources = [
  "free",
  "subscription",
  "family-seat",
  "development",
] as const;
export type PlanAssignmentSource = (typeof planAssignmentSources)[number];

const LOCAL_FULL_PLAN_ENVIRONMENTS = new Set(["development", "local"]);
const DEVELOPMENT_FULL_PLAN_EFFECTIVE_AT = "1970-01-01T00:00:00.000Z";

/** Stripeなどの決済事業者の語彙を利用側へ漏らさない、現在Planの読み取り契約。 */
export type AccountPlanAssignment = Readonly<{
  accountId: string;
  plan: PlanCode;
  source: PlanAssignmentSource;
  effectiveAt: string;
  availableUntil: string | null;
  payerAccountId: string | null;
}>;

export interface AccountPlanAssignmentProvider {
  findCurrent(accountId: string, at?: Date): Promise<AccountPlanAssignment>;
}

export class FakeAccountPlanAssignmentProvider implements AccountPlanAssignmentProvider {
  readonly #assignments = new Map<string, AccountPlanAssignment>();

  constructor(assignments: readonly AccountPlanAssignment[] = []) {
    for (const assignment of assignments) this.set(assignment);
  }

  set(assignment: AccountPlanAssignment): void {
    this.#assignments.set(assignment.accountId, Object.freeze({ ...assignment }));
  }

  async findCurrent(accountId: string, at = new Date()): Promise<AccountPlanAssignment> {
    const assignment = this.#assignments.get(accountId);
    if (
      assignment &&
      Date.parse(assignment.effectiveAt) <= at.getTime() &&
      (assignment.availableUntil === null || Date.parse(assignment.availableUntil) > at.getTime())
    ) {
      return assignment;
    }
    return freePlanAssignment(accountId, at);
  }
}

/** Localだけで全AccountへFullを付与する、永続化を伴わない開発用provider。 */
export class DevelopmentFullPlanAssignmentProvider implements AccountPlanAssignmentProvider {
  async findCurrent(accountId: string): Promise<AccountPlanAssignment> {
    return Object.freeze({
      accountId,
      plan: "full",
      source: "development",
      effectiveAt: DEVELOPMENT_FULL_PLAN_EFFECTIVE_AT,
      availableUntil: null,
      payerAccountId: null,
    });
  }
}

/** Localだけ開発用Fullへ差し替え、Preview・Productionでは実Planのproviderを保つ。 */
export function accountPlanAssignmentProviderForEnvironment(
  environment: string | undefined,
  fallback: AccountPlanAssignmentProvider,
): AccountPlanAssignmentProvider {
  return LOCAL_FULL_PLAN_ENVIRONMENTS.has(environment?.trim() ?? "")
    ? new DevelopmentFullPlanAssignmentProvider()
    : fallback;
}

export function freePlanAssignment(accountId: string, at = new Date()): AccountPlanAssignment {
  return Object.freeze({
    accountId,
    plan: "free",
    source: "free",
    effectiveAt: at.toISOString(),
    availableUntil: null,
    payerAccountId: null,
  });
}
