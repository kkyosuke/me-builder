import { and, asc, desc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import type {
  CompleteWeeklyReflectionGenerationInput,
  MonthlyChangeContent,
  MonthlyChangeView,
  RequestWeeklyReflectionGenerationResult,
  WeeklyReflectionGenerationContext,
  WeeklyReflectionReadModel,
} from "../../../weekly-reflection";
import { jstWeekRange, resolveJstWeekStart } from "../../../weekly-reflection";
import type { AccountDataDatabase } from "../database";
import { brainItems } from "../schema/brain";
import { diagnosisBrainProjectionHeads } from "../schema/diagnosis";
import {
  conversationMessages,
  conversationSessions,
  dailyPromptPreferences,
  sourceRecordTextPayloads,
} from "../schema/diary";
import { sourceRecords } from "../schema/source";
import {
  monthlyChangeVersions,
  weeklyReflectionGenerations,
  weeklyReflections,
} from "../schema/weekly-reflection";

const EVIDENCE_LIMIT = 80;
const DISPATCH_RECOVERY_MS = 30_000;

export async function readWeeklyReflections(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
  monthlyMode: "none" | "brief" | "full" = "none",
): Promise<WeeklyReflectionReadModel> {
  const weekStart = resolveJstWeekStart(at);
  const [rows, monthlyRows, generation] = await Promise.all([
    db.select().from(weeklyReflections).orderBy(desc(weeklyReflections.weekStart)).all(),
    db
      .select({ content: monthlyChangeVersions.content })
      .from(monthlyChangeVersions)
      .where(eq(monthlyChangeVersions.accountId, accountId))
      .orderBy(desc(monthlyChangeVersions.generatedAt))
      .all(),
    db
      .select()
      .from(weeklyReflectionGenerations)
      .where(
        and(
          eq(weeklyReflectionGenerations.accountId, accountId),
          eq(weeklyReflectionGenerations.weekStart, weekStart),
        ),
      )
      .get(),
  ]);
  return {
    reflections: rows.map(({ content }) => content),
    monthlyChanges: monthlyRows.map(({ content }) => projectMonthlyChange(content, monthlyMode)),
    generation: {
      weekStart,
      status: generation?.status ?? "idle",
      canGenerate: !generation || generation.status === "failed",
      message: generation?.status === "failed" ? generation.failureMessage : null,
      notification: generation?.notificationStatus ?? "not-applicable",
    },
  };
}

function projectMonthlyChange(
  content: MonthlyChangeContent,
  monthlyMode: "none" | "brief" | "full",
): MonthlyChangeView {
  if (monthlyMode === "full") return { ...content, mode: "full" };
  return {
    ...content,
    mode: monthlyMode === "brief" ? "brief" : "archived",
    previousMonthHeadline: null,
    changes: content.changes.slice(0, 1),
    ongoingGoals: content.ongoingGoals.slice(0, 1),
  };
}

function previousMonth(month: string): string {
  const [year, value] = month.split("-").map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (value ?? 1) - 2, 1));
  return at.toISOString().slice(0, 7);
}

async function materializeMonthlyChange(
  db: AccountDataDatabase,
  accountId: string,
  generatedAt: Date,
): Promise<void> {
  const month = generatedAt.toLocaleDateString("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  const reflections = await db
    .select()
    .from(weeklyReflections)
    .where(gte(weeklyReflections.weekStart, `${previousMonth(month)}-01`))
    .orderBy(desc(weeklyReflections.weekStart))
    .all();
  const current = reflections.filter(({ weekStart }) => weekStart.startsWith(month));
  if (current.length === 0) return;
  const prior = reflections.filter(({ weekStart }) => weekStart.startsWith(previousMonth(month)));
  const last = await db
    .select({ version: monthlyChangeVersions.version })
    .from(monthlyChangeVersions)
    .where(
      and(eq(monthlyChangeVersions.accountId, accountId), eq(monthlyChangeVersions.month, month)),
    )
    .orderBy(desc(monthlyChangeVersions.version))
    .get();
  const version = (last?.version ?? 0) + 1;
  const ongoingGoals = current.flatMap(({ content }) =>
    content.items.filter(({ kind }) => kind === "next-step").map(({ description }) => description),
  );
  const content = {
    month,
    version,
    generatedAt: generatedAt.toISOString(),
    headline: current[0]?.content.headline ?? `${month}の振り返り`,
    previousMonthHeadline: prior[0]?.content.headline ?? null,
    changes: current.map(({ content: reflection }) => reflection.headline),
    ongoingGoals: [...new Set(ongoingGoals)],
    evidenceWeekStarts: current.map(({ weekStart }) => weekStart),
  };
  await db.insert(monthlyChangeVersions).values({
    id: crypto.randomUUID(),
    accountId,
    month,
    version,
    generatedAt,
    content,
  });
}

export async function requestWeeklyReflectionGeneration(
  db: AccountDataDatabase,
  accountId: string,
  requestedAt = new Date(),
): Promise<RequestWeeklyReflectionGenerationResult> {
  const weekStart = resolveJstWeekStart(requestedAt);
  const existing = await db
    .select()
    .from(weeklyReflectionGenerations)
    .where(
      and(
        eq(weeklyReflectionGenerations.accountId, accountId),
        eq(weeklyReflectionGenerations.weekStart, weekStart),
      ),
    )
    .get();
  if (existing?.status === "failed") {
    await db
      .update(weeklyReflectionGenerations)
      .set({
        status: "queued",
        requestedAt,
        dispatchedAt: null,
        startedAt: null,
        finishedAt: null,
        failureMessage: null,
      })
      .where(eq(weeklyReflectionGenerations.id, existing.id))
      .run();
    return {
      outcome: "retried",
      generationId: existing.id,
      status: "queued",
      needsDispatch: true,
    };
  }
  if (existing) {
    return {
      outcome: "existing",
      generationId: existing.id,
      status: existing.status,
      needsDispatch: existing.status === "queued" && existing.dispatchedAt === null,
    };
  }
  const { from, until } = jstWeekRange(weekStart);
  const diary = await db
    .select({ id: sourceRecords.id })
    .from(conversationMessages)
    .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
    .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
    .where(
      and(
        eq(conversationSessions.accountId, accountId),
        eq(conversationMessages.role, "user"),
        eq(conversationMessages.isDeleted, false),
        eq(sourceRecords.isDeleted, false),
        gte(sourceRecords.createdAt, from),
        lt(sourceRecords.createdAt, until),
      ),
    )
    .limit(1)
    .get();
  const diagnosis = await db
    .select({ id: brainItems.id })
    .from(diagnosisBrainProjectionHeads)
    .innerJoin(brainItems, eq(diagnosisBrainProjectionHeads.currentBrainItemId, brainItems.id))
    .where(
      and(
        eq(diagnosisBrainProjectionHeads.accountId, accountId),
        eq(brainItems.status, "active"),
        eq(brainItems.isDeleted, false),
      ),
    )
    .limit(1)
    .get();
  if (!diary && !diagnosis) return { outcome: "unavailable", reason: "source_record_required" };

  const generationId = crypto.randomUUID();
  await db
    .insert(weeklyReflectionGenerations)
    .values({ id: generationId, accountId, weekStart, status: "queued", requestedAt })
    .run();
  return { outcome: "created", generationId, status: "queued", needsDispatch: true };
}

export async function listUndispatchedWeeklyReflectionGenerationIds(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
  limit = 10,
): Promise<string[]> {
  const rows = await db
    .select({ id: weeklyReflectionGenerations.id })
    .from(weeklyReflectionGenerations)
    .where(
      and(
        eq(weeklyReflectionGenerations.accountId, accountId),
        eq(weeklyReflectionGenerations.status, "queued"),
        isNull(weeklyReflectionGenerations.dispatchedAt),
        lte(weeklyReflectionGenerations.requestedAt, new Date(at.getTime() - DISPATCH_RECOVERY_MS)),
      ),
    )
    .orderBy(asc(weeklyReflectionGenerations.requestedAt))
    .limit(limit)
    .all();
  return rows.map(({ id }) => id);
}

export async function markWeeklyReflectionGenerationDispatched(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
  dispatchedAt = new Date(),
): Promise<boolean> {
  const row = await db
    .update(weeklyReflectionGenerations)
    .set({ dispatchedAt })
    .where(
      and(
        eq(weeklyReflectionGenerations.id, generationId),
        eq(weeklyReflectionGenerations.accountId, accountId),
        eq(weeklyReflectionGenerations.status, "queued"),
      ),
    )
    .returning({ id: weeklyReflectionGenerations.id })
    .get();
  return row?.id === generationId;
}

export async function loadWeeklyReflectionGenerationContext(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
  startedAt = new Date(),
): Promise<WeeklyReflectionGenerationContext | null> {
  const generation = await db
    .select()
    .from(weeklyReflectionGenerations)
    .where(
      and(
        eq(weeklyReflectionGenerations.id, generationId),
        eq(weeklyReflectionGenerations.accountId, accountId),
      ),
    )
    .get();
  if (!generation) return null;
  if (generation.status === "completed" || generation.status === "failed") return null;
  if (generation.status === "queued") {
    await db
      .update(weeklyReflectionGenerations)
      .set({ status: "generating", startedAt })
      .where(eq(weeklyReflectionGenerations.id, generationId))
      .run();
  }
  const { from, until } = jstWeekRange(generation.weekStart);
  const [diagnosisRows, diaryRows] = await Promise.all([
    db
      .select({ id: brainItems.id, text: brainItems.statement, recordedAt: brainItems.createdAt })
      .from(diagnosisBrainProjectionHeads)
      .innerJoin(brainItems, eq(diagnosisBrainProjectionHeads.currentBrainItemId, brainItems.id))
      .where(
        and(
          eq(diagnosisBrainProjectionHeads.accountId, accountId),
          eq(brainItems.status, "active"),
          eq(brainItems.isDeleted, false),
        ),
      )
      .orderBy(desc(brainItems.createdAt))
      .limit(EVIDENCE_LIMIT)
      .all(),
    db
      .select({
        id: sourceRecords.id,
        text: sourceRecordTextPayloads.body,
        recordedAt: sourceRecords.createdAt,
      })
      .from(conversationMessages)
      .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
      .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
      .innerJoin(
        sourceRecordTextPayloads,
        eq(sourceRecordTextPayloads.sourceRecordId, sourceRecords.id),
      )
      .where(
        and(
          eq(conversationSessions.accountId, accountId),
          eq(conversationMessages.role, "user"),
          eq(conversationMessages.isDeleted, false),
          eq(sourceRecords.isDeleted, false),
          gte(sourceRecords.createdAt, from),
          lt(sourceRecords.createdAt, until),
        ),
      )
      .orderBy(desc(sourceRecords.createdAt))
      .limit(EVIDENCE_LIMIT)
      .all(),
  ]);
  return {
    generationId,
    weekStart: generation.weekStart,
    evidence: [
      ...diagnosisRows.map((row) => ({
        id: `brain:${row.id}`,
        source: "diagnosis" as const,
        text: row.text,
        recordedAt: row.recordedAt,
      })),
      ...diaryRows.map((row) => ({
        id: `diary:${row.id}`,
        source: "diary" as const,
        text: row.text,
        recordedAt: row.recordedAt,
      })),
    ],
  };
}

export async function completeWeeklyReflectionGeneration(
  db: AccountDataDatabase,
  accountId: string,
  input: CompleteWeeklyReflectionGenerationInput,
): Promise<boolean> {
  const generation = await db
    .select()
    .from(weeklyReflectionGenerations)
    .where(
      and(
        eq(weeklyReflectionGenerations.id, input.generationId),
        eq(weeklyReflectionGenerations.accountId, accountId),
      ),
    )
    .get();
  if (!generation) return false;
  if (generation.status === "completed") return true;
  if (generation.status === "failed") return false;
  const preference = await db
    .select({ status: dailyPromptPreferences.status })
    .from(dailyPromptPreferences)
    .where(eq(dailyPromptPreferences.accountId, accountId))
    .get();
  const notificationStatus = preference?.status === "stopped" ? "skipped" : "pending";
  const content = {
    weekStart: generation.weekStart,
    generatedAt: input.generatedAt.toISOString(),
    headline: input.headline,
    items: input.items,
    recordCount: input.evidenceCount,
  };
  await db.batch([
    db
      .insert(weeklyReflections)
      .values({
        id: crypto.randomUUID(),
        generationId: input.generationId,
        weekStart: generation.weekStart,
        generatedAt: input.generatedAt,
        content,
      })
      .onConflictDoNothing(),
    db
      .update(weeklyReflectionGenerations)
      .set({
        status: "completed",
        finishedAt: input.generatedAt,
        failureMessage: null,
        model: input.model,
        promptVersion: input.promptVersion,
        notificationStatus,
      })
      .where(eq(weeklyReflectionGenerations.id, input.generationId)),
  ]);
  await materializeMonthlyChange(db, accountId, input.generatedAt);
  return true;
}

export async function failWeeklyReflectionGeneration(
  db: AccountDataDatabase,
  accountId: string,
  generationId: string,
  message: string,
  failedAt = new Date(),
): Promise<void> {
  await db
    .update(weeklyReflectionGenerations)
    .set({ status: "failed", failureMessage: message, finishedAt: failedAt })
    .where(
      and(
        eq(weeklyReflectionGenerations.id, generationId),
        eq(weeklyReflectionGenerations.accountId, accountId),
        inArray(weeklyReflectionGenerations.status, ["queued", "generating"]),
      ),
    )
    .run();
}
