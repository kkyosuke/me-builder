import { readActiveFamilySeatByMember } from "../d1/shared/action/family-seat";
import type { SharedD1Client } from "../d1/shared/client";
import {
  type AccountPlanAssignment,
  type AccountPlanAssignmentProvider,
  FakeAccountPlanAssignmentProvider,
  freePlanAssignment,
} from "./account-plan-assignment";

/** 共有D1の現在のactive席だけを、決済語彙を含まないPlan割当へ変換する。 */
export class FamilySeatAccountPlanAssignmentProvider implements AccountPlanAssignmentProvider {
  constructor(private readonly db: SharedD1Client) {}

  async findCurrent(accountId: string, at = new Date()): Promise<AccountPlanAssignment> {
    const membership = await readActiveFamilySeatByMember(this.db, accountId);
    if (!membership) return freePlanAssignment(accountId, at);
    const effectiveAt = membership.seat.activatedAt;
    if (!effectiveAt || Date.parse(effectiveAt) > at.getTime()) {
      return freePlanAssignment(accountId, at);
    }
    return Object.freeze({
      accountId,
      plan: "family",
      source: "family-seat",
      effectiveAt,
      availableUntil: null,
      payerAccountId: membership.pack.payerAccountId,
    });
  }
}

const assignmentPriority = (assignment: AccountPlanAssignment): number => {
  switch (assignment.plan) {
    case "family":
      return 3;
    case "full":
      return 2;
    case "lite":
      return 1;
    case "free":
      return 0;
  }
};

/** 通常PlanとFamily席を同じEntitlement境界で解決し、より強い有効な割当を返す。 */
export class FamilyAwareAccountPlanAssignmentProvider implements AccountPlanAssignmentProvider {
  readonly #family: FamilySeatAccountPlanAssignmentProvider;

  constructor(
    db: SharedD1Client,
    private readonly primary: AccountPlanAssignmentProvider = new FakeAccountPlanAssignmentProvider(),
  ) {
    this.#family = new FamilySeatAccountPlanAssignmentProvider(db);
  }

  async findCurrent(accountId: string, at = new Date()): Promise<AccountPlanAssignment> {
    const results = await Promise.allSettled([
      this.primary.findCurrent(accountId, at),
      this.#family.findCurrent(accountId, at),
    ]);
    const assignments = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const paid = assignments
      .filter((assignment) => assignment.plan !== "free")
      .sort((left, right) => assignmentPriority(right) - assignmentPriority(left))[0];
    if (paid) return paid;
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    return assignments[0] ?? freePlanAssignment(accountId, at);
  }
}
