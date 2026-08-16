import type { AiUsageKind, AiUsagePeriod } from "../do/account/action/ai-usage";
import type { ResolvedEntitlement } from "./entitlement";

const DAY_MS = 24 * 60 * 60 * 1_000;
const FREE_SUMMARY_PERIOD_MS = 90 * DAY_MS;

/** APIとWorkerが同じ利用枠を参照するための、Plan適用期間からの決定的なperiod解決。 */
export function resolveEntitlementUsagePeriod(
  entitlement: ResolvedEntitlement,
  kind: AiUsageKind,
  at = new Date(),
): AiUsagePeriod {
  assertValidDate(at);
  if (
    kind === "profile-summary" &&
    entitlement.policy.profileSummary.period === "rolling-90-days"
  ) {
    const bucket = Math.floor(at.getTime() / FREE_SUMMARY_PERIOD_MS);
    const start = new Date(bucket * FREE_SUMMARY_PERIOD_MS);
    const end = new Date(start.getTime() + FREE_SUMMARY_PERIOD_MS);
    return { key: `free-summary-90d:${bucket}`, start, end };
  }

  if (entitlement.source === "free") return utcCalendarMonth(at);
  return assignmentMonth(entitlement.effectiveAt, at);
}

function utcCalendarMonth(at: Date): AiUsagePeriod {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const month = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { key: `free-month:${month}`, start, end };
}

function assignmentMonth(effectiveAt: string, at: Date): AiUsagePeriod {
  const anchor = new Date(effectiveAt);
  assertValidDate(anchor);
  if (at < anchor) throw new Error("Usage period cannot precede the assignment");

  let monthOffset =
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + at.getUTCMonth() - anchor.getUTCMonth();
  let start = addUtcMonthsClamped(anchor, monthOffset);
  if (start > at) {
    monthOffset -= 1;
    start = addUtcMonthsClamped(anchor, monthOffset);
  }
  let end = addUtcMonthsClamped(anchor, monthOffset + 1);
  while (at >= end) {
    monthOffset += 1;
    start = end;
    end = addUtcMonthsClamped(anchor, monthOffset + 1);
  }
  return {
    key: `assignment-month:${effectiveAt}:${monthOffset}`,
    start,
    end,
  };
}

function addUtcMonthsClamped(anchor: Date, months: number): Date {
  const first = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + months,
      1,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return first;
}

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new Error("Usage period date is invalid");
}
