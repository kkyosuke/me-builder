export const planCodes = ["free", "lite", "full", "family"] as const;
export type PlanCode = (typeof planCodes)[number];

export const planAssignmentSources = ["free", "subscription", "family-seat"] as const;
export type PlanAssignmentSource = (typeof planAssignmentSources)[number];

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
