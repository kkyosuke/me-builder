import { readActiveFamilySeatByMember } from "../d1/shared/action/family-seat";
import type { SharedD1Client } from "../d1/shared/client";
import {
  type AccountPlanAssignment,
  type AccountPlanAssignmentProvider,
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
