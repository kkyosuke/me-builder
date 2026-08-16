import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import { type AiUsageKind, aiUsageRecords } from "../schema";

export type { AiUsageKind } from "../schema";

export const AI_USAGE_RESERVATION_TTL_MS = 15 * 60 * 1_000;

export type AiUsagePeriod = Readonly<{
  key: string;
  start: Date;
  end: Date;
}>;

export type ReserveAiUsageInput = Readonly<{
  requestId: string;
  kind: AiUsageKind;
  period: AiUsagePeriod;
  limit: number;
}>;

type AiUsageRecord = typeof aiUsageRecords.$inferSelect;

export type AiUsageSnapshot = Readonly<{
  kind: AiUsageKind;
  period: AiUsagePeriod;
  limit: number;
  reserved: number;
  committed: number;
  remaining: number;
}>;

export type ReserveAiUsageResult = Readonly<{
  outcome: "reserved" | "existing" | "limit-reached";
  reservation: AiUsageRecord | null;
  usage: AiUsageSnapshot;
}>;

export type TransitionAiUsageResult = Readonly<{
  outcome: "committed" | "released" | "unchanged" | "not-found";
  reservation: AiUsageRecord | null;
}>;

export async function reserveAiUsage(
  db: AccountDataDatabase,
  accountId: string,
  input: ReserveAiUsageInput,
  at = new Date(),
): Promise<ReserveAiUsageResult> {
  validateReservationInput(input, at);
  await expireAiUsageReservations(db, accountId, at);
  await assertPeriodKeyConsistency(db, accountId, input.kind, input.period);

  const existing = await findRecord(db, accountId, input.requestId);
  if (existing) {
    assertSameReservation(existing, input);
    return {
      outcome: "existing",
      reservation: existing,
      usage: await readAiUsage(db, accountId, input.kind, input.period, input.limit, at),
    };
  }

  const inserted = await db.all<{ request_id: string }>(sql`
    INSERT INTO ${aiUsageRecords} (
      request_id, account_id, kind, period_key, period_start, period_end,
      limit_snapshot, status, reserved_at, expires_at
    )
    SELECT
      ${input.requestId}, ${accountId}, ${input.kind}, ${input.period.key},
      ${input.period.start.getTime()}, ${input.period.end.getTime()}, ${input.limit}, 'reserved',
      ${at.getTime()}, ${at.getTime() + AI_USAGE_RESERVATION_TTL_MS}
    WHERE (
      SELECT COUNT(*) FROM ${aiUsageRecords}
      WHERE account_id = ${accountId}
        AND kind = ${input.kind}
        AND period_key = ${input.period.key}
        AND status IN ('reserved', 'committed')
    ) < ${input.limit}
    ON CONFLICT(request_id) DO NOTHING
    RETURNING request_id
  `);

  const reservation = await findRecord(db, accountId, input.requestId);
  const usage = await readAiUsage(db, accountId, input.kind, input.period, input.limit, at);
  return reservation && inserted.length > 0
    ? { outcome: "reserved", reservation, usage }
    : reservation
      ? { outcome: "existing", reservation, usage }
      : { outcome: "limit-reached", reservation: null, usage };
}

export async function commitAiUsage(
  db: AccountDataDatabase,
  accountId: string,
  requestId: string,
  at = new Date(),
): Promise<TransitionAiUsageResult> {
  validateRequestId(requestId);
  await expireAiUsageReservations(db, accountId, at);
  const existing = await findRecord(db, accountId, requestId);
  if (!existing) return { outcome: "not-found", reservation: null };
  if (existing.status !== "reserved") {
    return { outcome: "unchanged", reservation: existing };
  }

  await db
    .update(aiUsageRecords)
    .set({ status: "committed", committedAt: at })
    .where(
      and(
        eq(aiUsageRecords.requestId, requestId),
        eq(aiUsageRecords.accountId, accountId),
        eq(aiUsageRecords.status, "reserved"),
      ),
    );
  return {
    outcome: "committed",
    reservation: (await findRecord(db, accountId, requestId)) ?? null,
  };
}

export async function releaseAiUsage(
  db: AccountDataDatabase,
  accountId: string,
  requestId: string,
  at = new Date(),
): Promise<TransitionAiUsageResult> {
  validateRequestId(requestId);
  const existing = await findRecord(db, accountId, requestId);
  if (!existing) return { outcome: "not-found", reservation: null };
  if (existing.status !== "reserved") {
    return { outcome: "unchanged", reservation: existing };
  }

  await db
    .update(aiUsageRecords)
    .set({ status: "released", releasedAt: at, releaseReason: "cancelled" })
    .where(
      and(
        eq(aiUsageRecords.requestId, requestId),
        eq(aiUsageRecords.accountId, accountId),
        eq(aiUsageRecords.status, "reserved"),
      ),
    );
  return {
    outcome: "released",
    reservation: (await findRecord(db, accountId, requestId)) ?? null,
  };
}

export async function readAiUsage(
  db: AccountDataDatabase,
  accountId: string,
  kind: AiUsageKind,
  period: AiUsagePeriod,
  limit: number,
  at = new Date(),
): Promise<AiUsageSnapshot> {
  validatePeriod(period);
  validateLimit(limit);
  await expireAiUsageReservations(db, accountId, at);
  const rows = await db
    .select({ status: aiUsageRecords.status, count: sql<number>`count(*)` })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.accountId, accountId),
        eq(aiUsageRecords.kind, kind),
        eq(aiUsageRecords.periodKey, period.key),
        inArray(aiUsageRecords.status, ["reserved", "committed"]),
      ),
    )
    .groupBy(aiUsageRecords.status);
  const reserved = Number(rows.find(({ status }) => status === "reserved")?.count ?? 0);
  const committed = Number(rows.find(({ status }) => status === "committed")?.count ?? 0);
  return {
    kind,
    period,
    limit,
    reserved,
    committed,
    remaining: Math.max(0, limit - reserved - committed),
  };
}

export async function expireAiUsageReservations(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<number> {
  const released = await db
    .update(aiUsageRecords)
    .set({ status: "released", releasedAt: at, releaseReason: "timeout" })
    .where(
      and(
        eq(aiUsageRecords.accountId, accountId),
        eq(aiUsageRecords.status, "reserved"),
        lte(aiUsageRecords.expiresAt, at),
      ),
    )
    .returning({ requestId: aiUsageRecords.requestId });
  return released.length;
}

async function findRecord(
  db: AccountDataDatabase,
  accountId: string,
  requestId: string,
): Promise<AiUsageRecord | undefined> {
  return db
    .select()
    .from(aiUsageRecords)
    .where(and(eq(aiUsageRecords.accountId, accountId), eq(aiUsageRecords.requestId, requestId)))
    .get();
}

function validateReservationInput(input: ReserveAiUsageInput, at: Date): void {
  validateRequestId(input.requestId);
  validatePeriod(input.period);
  validateLimit(input.limit);
  if (!Number.isFinite(at.getTime()) || at < input.period.start || at >= input.period.end) {
    throw new Error("AI usage reservation must start inside its period");
  }
}

function validateRequestId(requestId: string): void {
  if (requestId.length === 0 || requestId.length > 200) {
    throw new Error("AI usage request ID must contain 1 to 200 characters");
  }
}

function validatePeriod(period: AiUsagePeriod): void {
  if (
    period.key.length === 0 ||
    period.key.length > 200 ||
    !Number.isFinite(period.start.getTime()) ||
    !Number.isFinite(period.end.getTime()) ||
    period.start >= period.end
  ) {
    throw new Error("AI usage period is invalid");
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("AI usage limit must be a non-negative safe integer");
  }
}

function assertSameReservation(record: AiUsageRecord, input: ReserveAiUsageInput): void {
  if (
    record.kind !== input.kind ||
    record.periodKey !== input.period.key ||
    record.periodStart.getTime() !== input.period.start.getTime() ||
    record.periodEnd.getTime() !== input.period.end.getTime()
  ) {
    throw new Error("AI usage request ID is already bound to another reservation");
  }
}

async function assertPeriodKeyConsistency(
  db: AccountDataDatabase,
  accountId: string,
  kind: AiUsageKind,
  period: AiUsagePeriod,
): Promise<void> {
  const existing = await db
    .select({ start: aiUsageRecords.periodStart, end: aiUsageRecords.periodEnd })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.accountId, accountId),
        eq(aiUsageRecords.kind, kind),
        eq(aiUsageRecords.periodKey, period.key),
      ),
    )
    .get();
  if (
    existing &&
    (existing.start.getTime() !== period.start.getTime() ||
      existing.end.getTime() !== period.end.getTime())
  ) {
    throw new Error("AI usage period key is already bound to another time range");
  }
}
