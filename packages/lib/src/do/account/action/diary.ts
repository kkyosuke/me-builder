import { toTokyoLocalDate } from "@me-builder/shared";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { AccountDataDatabase } from "../database";
import {
  type PromptContext,
  type PromptContextCollectionTarget,
  arePromptContextsEqual,
  buildPromptContextCollectionCandidates,
  findPrecedingAssistantBodies,
  isPromptContextGrounded,
  parsePromptContext,
  parsePromptContextCollectionTarget,
  readPromptContext,
} from "../prompt-context";
import {
  accountDataIdentity,
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemRevisions,
  brainItemTopicLabels,
  brainItems,
  brainVectorSyncJobs,
  chatTurns,
  conversationMessages,
  conversationSessions,
  dailyPromptDeliveries,
  dailyPromptPreferences,
  diaryBrainCheckpointItems,
  diaryBrainCheckpoints,
  diaryChatBrainUsageAudits,
  sourceRecordTextPayloads,
  sourceRecords,
} from "../schema";
import {
  type DiaryTemporalContext,
  buildDiaryTemporalSearchText,
  readDiaryTemporalContext,
  resolveDiaryTemporalContext,
} from "./diary-temporal";
import { progressionPendingStatement } from "./progression";

const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;
const BRAIN_CHECKPOINT_INACTIVITY_MS = 10 * 60 * 1000;
const BRAIN_CHECKPOINT_HARD_CAP_MS = 30 * 60 * 1000;
const BRAIN_CHECKPOINT_MAX_USER_MESSAGES = 10;
const BRAIN_CHECKPOINT_MAX_USER_MESSAGE_CHARS = 5_000;
export const DIARY_BRAIN_CATEGORIES = [
  "identity",
  "memory",
  "behavior_pattern",
  "value_motivation",
  "decision_system",
  "preference",
  "goal",
] as const;
export type DiaryBrainCategory = (typeof DIARY_BRAIN_CATEGORIES)[number];
const DIARY_BRAIN_CATEGORY_SET = new Set<string>(DIARY_BRAIN_CATEGORIES);
const DIARY_BRAIN_STABILITY: Record<DiaryBrainCategory, "temporary" | "changeable" | "stable"> = {
  identity: "changeable",
  memory: "stable",
  behavior_pattern: "changeable",
  value_motivation: "changeable",
  decision_system: "changeable",
  preference: "changeable",
  goal: "temporary",
};
/** Checkpointは`account_id`を持たないため、所有者は親のSessionから導出する。 */
function ownedSessionIds(db: AccountDataDatabase, accountId: string) {
  return db
    .select({ id: conversationSessions.id })
    .from(conversationSessions)
    .where(eq(conversationSessions.accountId, accountId));
}

const BRAIN_CHECKPOINT_DISPATCH_RETRY_BASE_MS = 30 * 1000;
const BRAIN_CHECKPOINT_DISPATCH_RETRY_MAX_MS = 15 * 60 * 1000;
/** Queueの6回の配送機会を待った後、DLQ滞留をAlarmから自己回復するまでのlease。 */
export const DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS = 60 * 60 * 1000;
/** Queue内の最大6配送を5回まで投入し、合計30配送で恒久失敗を終端化する。 */
export const DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS = 5;
const CONVERSATION_POLICY_EXPLORATION_RATE = 0.2;

function isRevisionedPromptContextKind(kind: PromptContext["kind"]): boolean {
  return kind === "occupation" || kind === "weekly_rhythm";
}

export type ConversationPolicyStat = {
  policyId: string;
  replyOpportunityCount: number;
  replyCount: number;
};

function randomItem<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  if (item === undefined) throw new Error("Cannot select an item from an empty list");
  return item;
}

/** 未試行方針と探索を優先し、それ以外では本人の返信率が最も高い方針を選ぶ。 */
export function chooseConversationPolicyId(
  policyIds: readonly string[],
  stats: readonly ConversationPolicyStat[],
  random: () => number = Math.random,
): string {
  if (policyIds.length === 0 || new Set(policyIds).size !== policyIds.length) {
    throw new Error("Conversation policy IDs must be a non-empty unique list");
  }
  const statsByPolicyId = new Map(stats.map((stat) => [stat.policyId, stat]));
  const untried = policyIds.filter(
    (policyId) => (statsByPolicyId.get(policyId)?.replyOpportunityCount ?? 0) === 0,
  );
  if (untried.length > 0) return randomItem(untried, random);
  if (random() < CONVERSATION_POLICY_EXPLORATION_RATE) return randomItem(policyIds, random);

  const highestReplyRate = Math.max(
    ...policyIds.map((policyId) => {
      const stat = statsByPolicyId.get(policyId);
      return stat ? stat.replyCount / stat.replyOpportunityCount : 0;
    }),
  );
  const bestPolicyIds = policyIds.filter((policyId) => {
    const stat = statsByPolicyId.get(policyId);
    return stat ? stat.replyCount / stat.replyOpportunityCount === highestReplyRate : false;
  });
  return randomItem(bestPolicyIds, random);
}

async function selectConversationPolicyId(
  db: AccountDataDatabase,
  accountId: string,
  policyIds: readonly string[],
): Promise<string> {
  const sessions = await db
    .select({
      policyId: conversationSessions.conversationPolicyId,
      replyOpportunityCount: conversationSessions.replyOpportunityCount,
      replyCount: conversationSessions.replyCount,
    })
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.accountId, accountId),
        inArray(conversationSessions.conversationPolicyId, [...policyIds]),
      ),
    );
  const aggregate = new Map<string, ConversationPolicyStat>();
  for (const session of sessions) {
    const current = aggregate.get(session.policyId) ?? {
      policyId: session.policyId,
      replyOpportunityCount: 0,
      replyCount: 0,
    };
    current.replyOpportunityCount += session.replyOpportunityCount;
    current.replyCount += session.replyCount;
    aggregate.set(session.policyId, current);
  }
  return chooseConversationPolicyId(policyIds, [...aggregate.values()]);
}

export type StoredLineSource = {
  sourceRecordId: string;
  eventId: string;
  receivedAt: Date;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type DailyPromptPreparation =
  | Readonly<{ type: "ready"; deliveryId: string; promptVersion: string }>
  | Readonly<{
      type: "not-ready";
      status: "delivered" | "skipped" | "failed";
      reason?: DailyPromptSkipReason;
    }>;

type DailyPromptSkipReason =
  | "manual_stopped"
  | "stale"
  | "active_session"
  | "user_activity"
  | "recent_unanswered"
  | "auto_paused";

export type DailyPromptSameDayContext = "same_day";

function assertLocalDate(localDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("Daily prompt date is invalid");
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new Error("Daily prompt date is invalid");
  }
}

function nextLocalDate(localDate: string): string {
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** 配送日の最新の終了済みSessionが、同日中の続きを許可しているかを返す。 */
export async function selectDailyPromptSameDayContext(
  db: AccountDataDatabase,
  accountId: string,
  localDate: string,
  at: Date = new Date(),
): Promise<DailyPromptSameDayContext | undefined> {
  assertLocalDate(localDate);
  // 18時時点で期限切れだったSessionも含めてから、配送日の最新Sessionを選ぶ。
  await closeExpiredSessions(db, at);
  const localDayStartedAt = new Date(`${localDate}T00:00:00.000+09:00`);
  const nextLocalDayStartedAt = new Date(`${nextLocalDate(localDate)}T00:00:00.000+09:00`);
  const latestSession = await db
    .select({ id: conversationSessions.id, closeReason: conversationSessions.closeReason })
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.accountId, accountId),
        eq(conversationSessions.status, "closed"),
        eq(conversationSessions.isDeleted, false),
        gte(conversationSessions.closedAt, localDayStartedAt),
        lt(conversationSessions.closedAt, nextLocalDayStartedAt),
        lte(conversationSessions.closedAt, at),
      ),
    )
    .orderBy(desc(conversationSessions.closedAt), desc(conversationSessions.id))
    .get();
  if (!latestSession || latestSession.closeReason !== "explicit") return undefined;

  const finalTurn = await db
    .select({
      fromSequence: chatTurns.fromSequence,
      throughSequence: chatTurns.throughSequence,
      endSession: chatTurns.endSession,
      dailyPromptFollowUp: chatTurns.dailyPromptFollowUp,
    })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.sessionId, latestSession.id),
        eq(chatTurns.status, "delivered"),
        eq(chatTurns.isDeleted, false),
      ),
    )
    .orderBy(desc(chatTurns.throughSequence), desc(chatTurns.id))
    .get();
  if (!finalTurn?.endSession || finalTurn.dailyPromptFollowUp !== "same_day") return undefined;

  const activeUserSource = await db
    .select({ id: sourceRecords.id })
    .from(conversationMessages)
    .innerJoin(sourceRecords, eq(sourceRecords.id, conversationMessages.sourceRecordId))
    .where(
      and(
        eq(conversationMessages.sessionId, latestSession.id),
        eq(conversationMessages.role, "user"),
        eq(conversationMessages.isDeleted, false),
        gte(conversationMessages.sequence, finalTurn.fromSequence),
        lte(conversationMessages.sequence, finalTurn.throughSequence),
        eq(sourceRecords.accountId, accountId),
        eq(sourceRecords.isDeleted, false),
        gte(sourceRecords.createdAt, localDayStartedAt),
        lt(sourceRecords.createdAt, nextLocalDayStartedAt),
        lte(sourceRecords.createdAt, at),
      ),
    )
    .get();
  return activeUserSource ? "same_day" : undefined;
}

async function skipDailyPrompt(
  db: AccountDataDatabase,
  input: Readonly<{
    accountId: string;
    localDate: string;
    promptVersion: string;
    reason: DailyPromptSkipReason;
    at: Date;
  }>,
): Promise<DailyPromptPreparation> {
  const deliveryId = `daily-prompt:${input.localDate}`;
  const updated = await db
    .update(dailyPromptDeliveries)
    .set({ status: "skipped", skipReason: input.reason, updatedAt: input.at })
    .where(
      and(
        eq(dailyPromptDeliveries.id, deliveryId),
        eq(dailyPromptDeliveries.accountId, input.accountId),
        eq(dailyPromptDeliveries.status, "pending"),
      ),
    )
    .returning({ id: dailyPromptDeliveries.id })
    .get();
  if (!updated) {
    await db.insert(dailyPromptDeliveries).values({
      id: deliveryId,
      accountId: input.accountId,
      localDate: input.localDate,
      promptVersion: input.promptVersion,
      status: "skipped",
      skipReason: input.reason,
      createdAt: input.at,
      updatedAt: input.at,
    });
  }
  return { type: "not-ready", status: "skipped", reason: input.reason };
}

async function hasActiveConversation(
  db: AccountDataDatabase,
  accountId: string,
  at: Date,
): Promise<boolean> {
  await closeExpiredSessions(db, at);
  const activeSession = await db
    .select({ id: conversationSessions.id })
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.accountId, accountId),
        eq(conversationSessions.status, "active"),
        eq(conversationSessions.isDeleted, false),
      ),
    )
    .get();
  return Boolean(activeSession);
}

async function isDailyPromptStopped(db: AccountDataDatabase, accountId: string): Promise<boolean> {
  const preference = await db
    .select({ status: dailyPromptPreferences.status })
    .from(dailyPromptPreferences)
    .where(eq(dailyPromptPreferences.accountId, accountId))
    .get();
  return preference?.status === "stopped";
}

/** 当日の固定声かけを1回だけ準備し、再配送時も現在の送信可否を再評価する。 */
export async function prepareDailyPrompt(
  db: AccountDataDatabase,
  accountId: string,
  input: Readonly<{ localDate: string; promptVersion: string; at?: Date }>,
): Promise<DailyPromptPreparation> {
  assertLocalDate(input.localDate);
  if (!input.promptVersion.trim()) throw new Error("Daily prompt version is required");
  const at = input.at ?? new Date();
  const existing = await db
    .select()
    .from(dailyPromptDeliveries)
    .where(
      and(
        eq(dailyPromptDeliveries.accountId, accountId),
        eq(dailyPromptDeliveries.localDate, input.localDate),
        eq(dailyPromptDeliveries.isDeleted, false),
      ),
    )
    .get();
  if (existing && existing.status !== "pending") {
    return {
      type: "not-ready",
      status: existing.status,
      ...(existing.skipReason ? { reason: existing.skipReason } : {}),
    };
  }

  if (toTokyoLocalDate(at.getTime()) !== input.localDate) {
    return await skipDailyPrompt(db, {
      accountId,
      localDate: input.localDate,
      promptVersion: existing?.promptVersion ?? input.promptVersion,
      reason: "stale",
      at,
    });
  }
  if (await isDailyPromptStopped(db, accountId)) {
    return await skipDailyPrompt(db, {
      accountId,
      localDate: input.localDate,
      promptVersion: existing?.promptVersion ?? input.promptVersion,
      reason: "manual_stopped",
      at,
    });
  }
  if (existing?.respondedAt) {
    return await skipDailyPrompt(db, {
      accountId,
      localDate: input.localDate,
      promptVersion: existing.promptVersion,
      reason: "user_activity",
      at,
    });
  }
  if (await hasActiveConversation(db, accountId, at)) {
    return await skipDailyPrompt(db, {
      accountId,
      localDate: input.localDate,
      promptVersion: existing?.promptVersion ?? input.promptVersion,
      reason: "active_session",
      at,
    });
  }
  if (existing) {
    return { type: "ready", deliveryId: existing.id, promptVersion: existing.promptVersion };
  }

  const latestDelivered = await db
    .select({
      localDate: dailyPromptDeliveries.localDate,
      respondedAt: dailyPromptDeliveries.respondedAt,
    })
    .from(dailyPromptDeliveries)
    .where(
      and(
        eq(dailyPromptDeliveries.accountId, accountId),
        eq(dailyPromptDeliveries.status, "delivered"),
        eq(dailyPromptDeliveries.isDeleted, false),
      ),
    )
    .orderBy(desc(dailyPromptDeliveries.localDate))
    .limit(3)
    .all();
  const consecutiveUnanswered = latestDelivered.findIndex(
    ({ respondedAt }) => respondedAt !== null,
  );
  const unansweredCount =
    consecutiveUnanswered === -1 ? latestDelivered.length : consecutiveUnanswered;
  if (unansweredCount >= 3) {
    return await skipDailyPrompt(db, {
      accountId,
      localDate: input.localDate,
      promptVersion: input.promptVersion,
      reason: "auto_paused",
      at,
    });
  }
  const previous = latestDelivered[0];
  if (previous?.respondedAt === null && nextLocalDate(previous.localDate) === input.localDate) {
    return await skipDailyPrompt(db, {
      accountId,
      localDate: input.localDate,
      promptVersion: input.promptVersion,
      reason: "recent_unanswered",
      at,
    });
  }

  const deliveryId = `daily-prompt:${input.localDate}`;
  await db.insert(dailyPromptDeliveries).values({
    id: deliveryId,
    accountId,
    localDate: input.localDate,
    promptVersion: input.promptVersion,
    status: "pending",
    createdAt: at,
    updatedAt: at,
  });
  return { type: "ready", deliveryId, promptVersion: input.promptVersion };
}

export async function markDailyPromptDelivered(
  db: AccountDataDatabase,
  accountId: string,
  deliveryId: string,
  at = new Date(),
): Promise<boolean> {
  const delivery = await db
    .select({ status: dailyPromptDeliveries.status })
    .from(dailyPromptDeliveries)
    .where(
      and(
        eq(dailyPromptDeliveries.id, deliveryId),
        eq(dailyPromptDeliveries.accountId, accountId),
        eq(dailyPromptDeliveries.isDeleted, false),
      ),
    )
    .get();
  if (delivery?.status === "delivered") return true;
  if (delivery?.status !== "pending") return false;
  await db
    .update(dailyPromptDeliveries)
    .set({ status: "delivered", deliveredAt: at, updatedAt: at })
    .where(
      and(
        eq(dailyPromptDeliveries.id, deliveryId),
        eq(dailyPromptDeliveries.accountId, accountId),
        eq(dailyPromptDeliveries.status, "pending"),
      ),
    );
  return true;
}

export async function markDailyPromptFailed(
  db: AccountDataDatabase,
  accountId: string,
  deliveryId: string,
  failureStage: string,
  at = new Date(),
): Promise<boolean> {
  if (!failureStage.trim()) throw new Error("Daily prompt failure stage is required");
  const updated = await db
    .update(dailyPromptDeliveries)
    .set({ status: "failed", failureStage, updatedAt: at })
    .where(
      and(
        eq(dailyPromptDeliveries.id, deliveryId),
        eq(dailyPromptDeliveries.accountId, accountId),
        eq(dailyPromptDeliveries.status, "pending"),
      ),
    )
    .returning({ id: dailyPromptDeliveries.id })
    .get();
  return Boolean(updated);
}

/** LINE eventを不変なSource Recordとして冪等に保存する。 */
export async function storeLineTextSource(
  db: AccountDataDatabase,
  input: {
    accountId: string;
    eventId: string;
    body: string;
    receivedAt: Date;
    resetEpoch?: number;
    dailyPromptControl?: "stop";
  },
): Promise<StoredLineSource> {
  if (input.resetEpoch !== undefined) {
    const currentResetEpoch = await db
      .select({ resetEpoch: accountDataIdentity.resetEpoch })
      .from(accountDataIdentity)
      .where(eq(accountDataIdentity.accountId, input.accountId))
      .get();
    if (currentResetEpoch?.resetEpoch !== input.resetEpoch) {
      throw new Error("AccountData reset epoch is stale");
    }
  }
  const originalRef = `line:${input.eventId}`;
  const existing = await db
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(
      and(eq(sourceRecords.accountId, input.accountId), eq(sourceRecords.originalRef, originalRef)),
    )
    .get();
  if (existing) {
    return {
      sourceRecordId: existing.id,
      eventId: input.eventId,
      receivedAt: input.receivedAt,
    };
  }
  const sourceRecordId = `line-${await sha256(`${input.accountId}:${input.eventId}`)}`;
  const now = new Date();

  const statements: BatchItem<"sqlite">[] = [
    db
      .insert(sourceRecords)
      .values({
        id: sourceRecordId,
        accountId: input.accountId,
        kind: "user_input",
        accessLabel: "private",
        originalRef,
        createdAt: input.receivedAt,
        updatedAt: now,
      })
      .onConflictDoNothing(),
    db
      .insert(sourceRecordTextPayloads)
      .values({
        sourceRecordId,
        body: input.body,
        contentType: "text/plain",
        contentHash: await sha256(input.body),
        createdAt: input.receivedAt,
      })
      .onConflictDoNothing(),
    db
      .update(dailyPromptDeliveries)
      .set({ respondedAt: input.receivedAt, updatedAt: now })
      .where(
        and(
          eq(dailyPromptDeliveries.accountId, input.accountId),
          inArray(dailyPromptDeliveries.status, ["pending", "delivered"]),
          isNull(dailyPromptDeliveries.respondedAt),
          lte(dailyPromptDeliveries.createdAt, input.receivedAt),
          eq(dailyPromptDeliveries.isDeleted, false),
        ),
      ),
  ];
  const controlStatus = input.dailyPromptControl === "stop" ? "stopped" : "active";
  const controlledAtEpochMilliseconds = input.receivedAt.getTime();
  const isNewerControl = sql`${dailyPromptPreferences.controlledAt} < ${controlledAtEpochMilliseconds}
    OR (${dailyPromptPreferences.controlledAt} = ${controlledAtEpochMilliseconds}
      AND ${dailyPromptPreferences.controlSourceRecordId} < ${sourceRecordId})`;
  statements.splice(
    2,
    0,
    db
      .insert(dailyPromptPreferences)
      .values({
        accountId: input.accountId,
        status: controlStatus,
        controlledAt: input.receivedAt,
        controlSourceRecordId: sourceRecordId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dailyPromptPreferences.accountId,
        set: {
          status: controlStatus,
          controlledAt: input.receivedAt,
          controlSourceRecordId: sourceRecordId,
          updatedAt: now,
        },
        setWhere: isNewerControl,
      }),
  );
  if (controlStatus === "stopped") {
    statements.splice(
      3,
      0,
      db
        .update(dailyPromptDeliveries)
        .set({ status: "skipped", skipReason: "manual_stopped", updatedAt: now })
        .where(
          and(
            eq(dailyPromptDeliveries.accountId, input.accountId),
            eq(dailyPromptDeliveries.status, "pending"),
            eq(dailyPromptDeliveries.isDeleted, false),
            sql`EXISTS (
              SELECT 1 FROM ${dailyPromptPreferences}
              WHERE ${dailyPromptPreferences.accountId} = ${input.accountId}
                AND ${dailyPromptPreferences.status} = 'stopped'
                AND ${dailyPromptPreferences.controlSourceRecordId} = ${sourceRecordId}
            )`,
          ),
        ),
    );
  }
  await db.batch(statements);

  return {
    sourceRecordId,
    eventId: input.eventId,
    receivedAt: input.receivedAt,
  };
}

export type AttachMessageInput = StoredLineSource;

export type AttachedTurn = {
  turnId: string;
  sessionId: string;
  generationEpoch: number;
};

function diaryBrainCheckpointDueAt(firstMessageAt: Date, lastMessageAt: Date): Date {
  return new Date(
    Math.min(
      firstMessageAt.getTime() + BRAIN_CHECKPOINT_HARD_CAP_MS,
      lastMessageAt.getTime() + BRAIN_CHECKPOINT_INACTIVITY_MS,
    ),
  );
}

/** Coordinatorが予約した順序でuser messageをSessionへ追加し、1 Turnを作る。 */
export async function attachMessagesToTurn(
  db: AccountDataDatabase,
  accountId: string,
  inputs: AttachMessageInput[],
  generationEpoch: number,
  model: string,
  promptVersion: string,
  conversationPolicyIds: readonly string[] = ["reflective"],
): Promise<AttachedTurn> {
  if (inputs.length === 0) {
    throw new Error("Cannot create a chat turn without messages");
  }
  if (!promptVersion.trim()) {
    throw new Error("A chat turn must record its prompt version");
  }
  if (
    conversationPolicyIds.length === 0 ||
    conversationPolicyIds.some((policyId) => !policyId.trim()) ||
    new Set(conversationPolicyIds).size !== conversationPolicyIds.length
  ) {
    throw new Error("Conversation policy IDs must be a non-empty unique list");
  }
  const eventIds = inputs.map((input) => input.eventId);
  if (new Set(eventIds).size !== eventIds.length) {
    throw new Error("A chat turn cannot contain duplicate channel events");
  }
  const existingMessages = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.channel, "line"),
        inArray(conversationMessages.channelEventId, eventIds),
      ),
    )
    .all();

  if (existingMessages.length > 0) {
    const inputsByEventId = new Map(inputs.map((input) => [input.eventId, input]));
    if (
      existingMessages.some((message) => {
        const input = inputsByEventId.get(message.channelEventId ?? "");
        return !input || message.role !== "user" || message.sourceRecordId !== input.sourceRecordId;
      })
    ) {
      throw new Error("Existing conversation messages do not match the requested channel events");
    }
    const sessionIds = [...new Set(existingMessages.map(({ sessionId }) => sessionId))];
    const existingSessions = await db
      .select({ id: conversationSessions.id, accountId: conversationSessions.accountId })
      .from(conversationSessions)
      .where(inArray(conversationSessions.id, sessionIds))
      .all();
    if (
      existingSessions.length !== sessionIds.length ||
      existingSessions.some((session) => session.accountId !== accountId)
    ) {
      throw new Error("Existing conversation messages belong to another account");
    }

    if (existingMessages.length === inputs.length) {
      const existingTurns = [];
      for (const message of existingMessages) {
        const turn = await db
          .select()
          .from(chatTurns)
          .where(
            and(
              eq(chatTurns.sessionId, message.sessionId),
              lte(chatTurns.fromSequence, message.sequence),
              gte(chatTurns.throughSequence, message.sequence),
            ),
          )
          .get();
        if (!turn) throw new Error("Conversation messages exist without their chat turn");
        existingTurns.push(turn);
      }
      const existingTurn = existingTurns.sort(
        (left, right) => left.generationEpoch - right.generationEpoch,
      )[0];
      if (!existingTurn) throw new Error("Existing conversation messages are incomplete");
      return {
        turnId: existingTurn.id,
        sessionId: existingTurn.sessionId,
        generationEpoch: existingTurn.generationEpoch,
      };
    }

    const attachedEventIds = new Set(existingMessages.map(({ channelEventId }) => channelEventId));
    return attachMessagesToTurn(
      db,
      accountId,
      inputs.filter(({ eventId }) => !attachedEventIds.has(eventId)),
      generationEpoch,
      model,
      promptVersion,
      conversationPolicyIds,
    );
  }

  const firstReceivedAt = new Date(Math.min(...inputs.map((input) => input.receivedAt.getTime())));
  const lastReceivedAt = new Date(Math.max(...inputs.map((input) => input.receivedAt.getTime())));
  let session = await db
    .select()
    .from(conversationSessions)
    .where(
      and(eq(conversationSessions.accountId, accountId), eq(conversationSessions.status, "active")),
    )
    .get();

  const sessionHardCapAt = session
    ? new Date(session.startedAt.getTime() + SESSION_HARD_CAP_MS)
    : undefined;
  const writes: BatchItem<"sqlite">[] = [];
  if (
    session &&
    sessionHardCapAt &&
    (lastReceivedAt.getTime() - session.lastUserMessageAt.getTime() >= SESSION_INACTIVITY_MS ||
      lastReceivedAt >= sessionHardCapAt)
  ) {
    writes.push(
      db
        .update(conversationSessions)
        .set({
          status: "closed",
          closedAt: lastReceivedAt,
          closeReason: lastReceivedAt >= sessionHardCapAt ? "hard_cap" : "inactive",
          updatedAt: lastReceivedAt,
        })
        .where(eq(conversationSessions.id, session.id)),
    );
    session = undefined;
  }

  if (!session) {
    const conversationPolicyId = await selectConversationPolicyId(
      db,
      accountId,
      conversationPolicyIds,
    );
    session = {
      id: crypto.randomUUID(),
      accountId,
      status: "active" as const,
      startedAt: firstReceivedAt,
      lastUserMessageAt: lastReceivedAt,
      lastAssistantMessageAt: null,
      closedAt: null,
      closeReason: null,
      conversationPolicyId,
      replyOpportunityCount: 0,
      replyCount: 0,
      awaitingReply: false,
      nextSequence: 1,
      createdAt: firstReceivedAt,
      updatedAt: lastReceivedAt,
      deletedAt: null,
      isDeleted: false,
    };
    writes.push(db.insert(conversationSessions).values(session));
  }

  const fromSequence = session.nextSequence;
  const sortedInputs = [...inputs].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const userMessages = sortedInputs.map((input, index) => ({
    id: crypto.randomUUID(),
    sessionId: session.id,
    sequence: fromSequence + index,
    role: "user" as const,
    sourceRecordId: input.sourceRecordId,
    assistantBody: null,
    channel: "line",
    channelEventId: input.eventId,
    turnId: null,
    sentAt: input.receivedAt,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    deletedAt: null,
    isDeleted: false,
  }));
  const throughSequence = fromSequence + userMessages.length - 1;
  const turnId = crypto.randomUUID();
  const now = new Date();
  const pendingBrainCheckpoint = await db
    .select()
    .from(diaryBrainCheckpoints)
    .where(
      and(
        eq(diaryBrainCheckpoints.sessionId, session.id),
        eq(diaryBrainCheckpoints.status, "pending"),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .get();
  const pendingBrainUserMessageCount = pendingBrainCheckpoint
    ? (
        await db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.sessionId, session.id),
              gte(conversationMessages.sequence, pendingBrainCheckpoint.fromSequence),
              lte(conversationMessages.sequence, pendingBrainCheckpoint.throughSequence),
              eq(conversationMessages.role, "user"),
              eq(conversationMessages.isDeleted, false),
            ),
          )
          .all()
      ).length
    : 0;

  const checkpointWrites: BatchItem<"sqlite">[] = [];
  type CheckpointDraft = {
    id: string;
    persisted: boolean;
    fromSequence: number;
    throughSequence: number;
    firstMessageAt: Date;
    lastMessageAt: Date;
    dueAt: Date;
    status: "pending" | "queued";
    userMessageCount: number;
    createdAt: Date;
  };
  const checkpointDrafts: CheckpointDraft[] = [];
  let checkpointDraft: CheckpointDraft | undefined = pendingBrainCheckpoint
    ? {
        id: pendingBrainCheckpoint.id,
        persisted: true,
        fromSequence: pendingBrainCheckpoint.fromSequence,
        throughSequence: pendingBrainCheckpoint.throughSequence,
        firstMessageAt: pendingBrainCheckpoint.firstMessageAt,
        lastMessageAt: pendingBrainCheckpoint.lastMessageAt,
        dueAt: pendingBrainCheckpoint.dueAt,
        status: "pending",
        userMessageCount: pendingBrainUserMessageCount,
        createdAt: pendingBrainCheckpoint.createdAt,
      }
    : undefined;
  for (const [index, input] of sortedInputs.entries()) {
    const sequence = fromSequence + index;
    const reachedTimeBoundary =
      checkpointDraft && input.receivedAt.getTime() >= checkpointDraft.dueAt.getTime();
    const reachedMessageBoundary =
      checkpointDraft && checkpointDraft.userMessageCount >= BRAIN_CHECKPOINT_MAX_USER_MESSAGES;
    if (checkpointDraft && (reachedTimeBoundary || reachedMessageBoundary)) {
      if (reachedMessageBoundary) {
        checkpointDraft.dueAt = new Date(
          Math.min(checkpointDraft.dueAt.getTime(), input.receivedAt.getTime()),
        );
      }
      checkpointDraft.status = "queued";
      checkpointDrafts.push(checkpointDraft);
      checkpointDraft = undefined;
    }
    if (!checkpointDraft) {
      checkpointDraft = {
        id: crypto.randomUUID(),
        persisted: false,
        fromSequence: sequence,
        throughSequence: sequence,
        firstMessageAt: input.receivedAt,
        lastMessageAt: input.receivedAt,
        dueAt: diaryBrainCheckpointDueAt(input.receivedAt, input.receivedAt),
        status: "pending",
        userMessageCount: 1,
        createdAt: now,
      };
      continue;
    }
    checkpointDraft.throughSequence = sequence;
    checkpointDraft.userMessageCount += 1;
    checkpointDraft.firstMessageAt = new Date(
      Math.min(checkpointDraft.firstMessageAt.getTime(), input.receivedAt.getTime()),
    );
    checkpointDraft.lastMessageAt = new Date(
      Math.max(checkpointDraft.lastMessageAt.getTime(), input.receivedAt.getTime()),
    );
    checkpointDraft.dueAt = diaryBrainCheckpointDueAt(
      checkpointDraft.firstMessageAt,
      checkpointDraft.lastMessageAt,
    );
  }
  if (checkpointDraft) checkpointDrafts.push(checkpointDraft);
  for (const checkpoint of checkpointDrafts) {
    if (checkpoint.persisted) {
      checkpointWrites.push(
        db
          .update(diaryBrainCheckpoints)
          .set({
            throughSequence: checkpoint.throughSequence,
            firstMessageAt: checkpoint.firstMessageAt,
            lastMessageAt: checkpoint.lastMessageAt,
            dueAt: checkpoint.dueAt,
            nextAttemptAt: checkpoint.dueAt,
            status: checkpoint.status,
            updatedAt: now,
          })
          .where(
            and(
              eq(diaryBrainCheckpoints.id, checkpoint.id),
              eq(diaryBrainCheckpoints.status, "pending"),
            ),
          ),
      );
    } else {
      checkpointWrites.push(
        db.insert(diaryBrainCheckpoints).values({
          id: checkpoint.id,
          sessionId: session.id,
          fromSequence: checkpoint.fromSequence,
          throughSequence: checkpoint.throughSequence,
          firstMessageAt: checkpoint.firstMessageAt,
          lastMessageAt: checkpoint.lastMessageAt,
          dueAt: checkpoint.dueAt,
          nextAttemptAt: checkpoint.dueAt,
          status: checkpoint.status,
          createdAt: checkpoint.createdAt,
          updatedAt: now,
        }),
      );
    }
  }

  writes.push(
    db.insert(conversationMessages).values(userMessages),
    db
      .update(conversationSessions)
      .set({
        nextSequence: throughSequence + 1,
        lastUserMessageAt: lastReceivedAt,
        awaitingReply: false,
        replyCount: sql`${conversationSessions.replyCount} + CASE WHEN ${conversationSessions.awaitingReply} THEN 1 ELSE 0 END`,
        updatedAt: now,
      })
      .where(eq(conversationSessions.id, session.id)),
    db.insert(chatTurns).values({
      id: turnId,
      sessionId: session.id,
      fromSequence,
      throughSequence,
      generationEpoch,
      status: "queued",
      promptVersion,
      model,
      receivedAt: firstReceivedAt,
      createdAt: now,
      updatedAt: now,
    }),
    ...checkpointWrites,
  );
  const [firstWrite, ...remainingWrites] = writes;
  if (!firstWrite) throw new Error("Chat turn did not produce any D1 writes");
  await db.batch([firstWrite, ...remainingWrites]);
  return { turnId, sessionId: session.id, generationEpoch };
}

export type ConversationContextMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  sequence: number;
  /** user messageは根拠Source Recordの受信時刻。旧形式やassistantでは省略する。 */
  recordedAt?: Date;
};

async function listCollectionAskedTargets(
  db: AccountDataDatabase,
  sessionId: string,
  throughSequence?: number,
): Promise<PromptContextCollectionTarget[]> {
  const rows = await db
    .select({
      themeId: chatTurns.collectionThemeId,
      kind: chatTurns.collectionKind,
    })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.sessionId, sessionId),
        inArray(chatTurns.status, ["delivery_pending", "delivered", "delivery_unknown"]),
        ...(throughSequence === undefined ? [] : [lte(chatTurns.throughSequence, throughSequence)]),
      ),
    )
    .orderBy(asc(chatTurns.fromSequence), asc(chatTurns.throughSequence), asc(chatTurns.id))
    .all();
  return rows.flatMap(({ themeId, kind }) => {
    const target = parsePromptContextCollectionTarget(themeId, kind);
    return target ? [target] : [];
  });
}

/** Turnと同じSessionの直近messageを、Account所有権を含むjoinで取得する。 */
export async function getTurnContext(
  db: AccountDataDatabase,
  turnId: string,
  messageLimit: number,
): Promise<
  | {
      accountId: string;
      conversationPolicyId: string;
      messages: ConversationContextMessage[];
      currentUserMessageIds: string[];
      collectionAskedTargets: PromptContextCollectionTarget[];
    }
  | undefined
> {
  const turn = await db
    .select({
      sessionId: chatTurns.sessionId,
      accountId: conversationSessions.accountId,
      conversationPolicyId: conversationSessions.conversationPolicyId,
      fromSequence: chatTurns.fromSequence,
      throughSequence: chatTurns.throughSequence,
    })
    .from(chatTurns)
    .innerJoin(conversationSessions, eq(chatTurns.sessionId, conversationSessions.id))
    .where(eq(chatTurns.id, turnId))
    .get();
  if (!turn) return undefined;

  const collectionAskedTargets = await listCollectionAskedTargets(
    db,
    turn.sessionId,
    turn.throughSequence,
  );

  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      sequence: conversationMessages.sequence,
      assistantBody: conversationMessages.assistantBody,
      userBody: sourceRecordTextPayloads.body,
      userRecordedAt: sourceRecords.createdAt,
    })
    .from(conversationMessages)
    .leftJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
    .leftJoin(
      sourceRecordTextPayloads,
      eq(sourceRecords.id, sourceRecordTextPayloads.sourceRecordId),
    )
    .where(
      and(
        eq(conversationMessages.sessionId, turn.sessionId),
        lte(conversationMessages.sequence, turn.throughSequence),
        eq(conversationMessages.isDeleted, false),
        or(isNull(sourceRecords.id), eq(sourceRecords.accountId, turn.accountId)),
      ),
    )
    .orderBy(desc(conversationMessages.sequence))
    .limit(Math.max(messageLimit, turn.throughSequence - turn.fromSequence + 1))
    .all();

  const messages = rows.reverse().flatMap((row) => {
    const body = row.role === "user" ? row.userBody : row.assistantBody;
    return body
      ? [
          {
            id: row.id,
            role: row.role,
            body,
            sequence: row.sequence,
            ...(row.role === "user" && row.userRecordedAt
              ? { recordedAt: row.userRecordedAt }
              : {}),
          },
        ]
      : [];
  });
  return {
    accountId: turn.accountId,
    conversationPolicyId: turn.conversationPolicyId,
    messages,
    currentUserMessageIds: messages
      .filter(
        ({ role, sequence }) =>
          role === "user" && sequence >= turn.fromSequence && sequence <= turn.throughSequence,
      )
      .map(({ id }) => id),
    collectionAskedTargets,
  };
}

export type DiaryBrainCheckpointCandidate = Readonly<{
  category: DiaryBrainCategory;
  statement: string;
  promptContext?: PromptContext;
  sourceMessageIds: readonly string[];
  evidenceStatements?: readonly Readonly<{
    sourceMessageId: string;
    statement: string;
  }>[];
  matchingBrainItemId?: string;
  deduplication?: "none" | "exact" | "semantic";
  dedupPromptVersion?: string;
}>;

type AppliedDiaryBrainCheckpointCandidate = Readonly<{
  category: DiaryBrainCategory;
  statement: string;
  sourceMessageIds: readonly string[];
  operation: "created" | "evidence_added";
  deduplication: "none" | "exact" | "semantic";
}>;

export type DiaryBrainCheckpointApplyResult = Readonly<{
  candidates: readonly AppliedDiaryBrainCheckpointCandidate[];
}>;

function temporalContextsConflict(
  left: DiaryTemporalContext | undefined,
  right: DiaryTemporalContext | undefined,
): boolean {
  if (!left || !right) return false;
  const key = (context: DiaryTemporalContext) =>
    context.resolutions
      .map(({ original, resolved }) => `${original}\u0000${resolved}`)
      .sort()
      .join("\u0001");
  return key(left) !== key(right);
}

function normalizeDiaryBrainComparison(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeDiaryBrainEvidenceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** Alarm時点で期限を迎えたcheckpointをQueue投入対象として返す。 */
export async function listDueDiaryBrainCheckpointIds(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ id: diaryBrainCheckpoints.id })
    .from(diaryBrainCheckpoints)
    .where(
      and(
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        inArray(diaryBrainCheckpoints.status, ["pending", "queued", "dispatched"]),
        sql`${diaryBrainCheckpoints.attemptCount} < ${DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS}`,
        lte(diaryBrainCheckpoints.nextAttemptAt, at),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .orderBy(diaryBrainCheckpoints.nextAttemptAt)
    .limit(10)
    .all();
  return rows.map(({ id }) => id);
}

export type DiaryBrainCheckpointClaimBatch = Readonly<{
  checkpointIds: readonly string[];
  terminalFailures: readonly Readonly<{
    checkpointId: string;
    attemptCount: number;
    failureCode: string;
  }>[];
}>;

/** 期限到来した範囲をsealし、Queue投入対象としてclaimする。 */
export async function claimDueDiaryBrainCheckpointIds(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<DiaryBrainCheckpointClaimBatch> {
  const terminalFailures = await db
    .update(diaryBrainCheckpoints)
    .set({ status: "failed", updatedAt: at })
    .where(
      and(
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        inArray(diaryBrainCheckpoints.status, ["pending", "queued", "dispatched"]),
        sql`${diaryBrainCheckpoints.attemptCount} >= ${DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS}`,
        lte(diaryBrainCheckpoints.nextAttemptAt, at),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .returning({
      checkpointId: diaryBrainCheckpoints.id,
      attemptCount: diaryBrainCheckpoints.attemptCount,
    })
    .all();
  const dueIds = await listDueDiaryBrainCheckpointIds(db, accountId, at);
  const claimedIds: string[] = [];
  for (const checkpointId of dueIds) {
    const checkpoint = await db
      .select({ attemptCount: diaryBrainCheckpoints.attemptCount })
      .from(diaryBrainCheckpoints)
      .where(eq(diaryBrainCheckpoints.id, checkpointId))
      .get();
    if (!checkpoint) continue;
    const retryDelayMs = Math.min(
      BRAIN_CHECKPOINT_DISPATCH_RETRY_BASE_MS * 2 ** Math.min(checkpoint.attemptCount, 5),
      BRAIN_CHECKPOINT_DISPATCH_RETRY_MAX_MS,
    );
    const rows = await db
      .update(diaryBrainCheckpoints)
      .set({
        status: "queued",
        nextAttemptAt: new Date(at.getTime() + retryDelayMs),
        attemptCount: sql`${diaryBrainCheckpoints.attemptCount} + 1`,
        updatedAt: at,
      })
      .where(
        and(
          eq(diaryBrainCheckpoints.id, checkpointId),
          inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
          inArray(diaryBrainCheckpoints.status, ["pending", "queued", "dispatched"]),
          sql`${diaryBrainCheckpoints.attemptCount} < ${DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS}`,
          lte(diaryBrainCheckpoints.nextAttemptAt, at),
          eq(diaryBrainCheckpoints.isDeleted, false),
        ),
      )
      .returning({ id: diaryBrainCheckpoints.id })
      .all();
    if (rows[0]) claimedIds.push(rows[0].id);
  }
  return {
    checkpointIds: claimedIds,
    terminalFailures: terminalFailures.map(({ checkpointId, attemptCount }) => ({
      checkpointId,
      attemptCount,
      failureCode: "DIARY_BRAIN_CHECKPOINT_ATTEMPTS_EXHAUSTED",
    })),
  };
}

/** 運用者が原因を解消した後、恒久失敗checkpointの固定範囲を最初から再試行する。 */
export async function resetFailedDiaryBrainCheckpoint(
  db: AccountDataDatabase,
  accountId: string,
  checkpointId: string,
  at = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(diaryBrainCheckpoints)
    .set({
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: at,
      updatedAt: at,
    })
    .where(
      and(
        eq(diaryBrainCheckpoints.id, checkpointId),
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        eq(diaryBrainCheckpoints.status, "failed"),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .returning({ id: diaryBrainCheckpoints.id })
    .all();
  return rows.length > 0;
}

/** Queue受理を記録し、lease期限まではAlarmによる再投入対象から外す。 */
export async function markDiaryBrainCheckpointDispatched(
  db: AccountDataDatabase,
  accountId: string,
  checkpointId: string,
  at = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(diaryBrainCheckpoints)
    .set({
      status: "dispatched",
      nextAttemptAt: new Date(at.getTime() + DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS),
      updatedAt: at,
    })
    .where(
      and(
        eq(diaryBrainCheckpoints.id, checkpointId),
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        eq(diaryBrainCheckpoints.status, "queued"),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .returning({ id: diaryBrainCheckpoints.id })
    .all();
  return updated.length > 0;
}

/** AI変換用に、checkpoint範囲の会話だけをAccount所有権付きで返す。 */
export async function getDiaryBrainCheckpointContext(
  db: AccountDataDatabase,
  accountId: string,
  checkpointId: string,
): Promise<
  | {
      checkpointId: string;
      sessionId: string;
      throughSequence: number;
      messages: ConversationContextMessage[];
      sourceMessageIds: string[];
    }
  | undefined
> {
  const checkpoint = await db
    .select()
    .from(diaryBrainCheckpoints)
    .where(
      and(
        eq(diaryBrainCheckpoints.id, checkpointId),
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        inArray(diaryBrainCheckpoints.status, ["queued", "dispatched"]),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .get();
  if (!checkpoint) return undefined;
  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      sequence: conversationMessages.sequence,
      assistantBody: conversationMessages.assistantBody,
      userBody: sourceRecordTextPayloads.body,
      userRecordedAt: sourceRecords.createdAt,
    })
    .from(conversationMessages)
    .leftJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
    .leftJoin(
      sourceRecordTextPayloads,
      eq(sourceRecords.id, sourceRecordTextPayloads.sourceRecordId),
    )
    .where(
      and(
        eq(conversationMessages.sessionId, checkpoint.sessionId),
        gte(conversationMessages.sequence, Math.max(1, checkpoint.fromSequence - 1)),
        lte(conversationMessages.sequence, checkpoint.throughSequence),
        eq(conversationMessages.isDeleted, false),
        or(
          and(
            eq(conversationMessages.role, "user"),
            gte(conversationMessages.sequence, checkpoint.fromSequence),
            eq(sourceRecords.accountId, accountId),
            eq(sourceRecords.isDeleted, false),
          ),
          eq(conversationMessages.role, "assistant"),
        ),
      ),
    )
    .orderBy(conversationMessages.sequence)
    .all();
  const messages = rows.flatMap((row) => {
    const body = row.role === "user" ? row.userBody : row.assistantBody;
    return body && body.length <= BRAIN_CHECKPOINT_MAX_USER_MESSAGE_CHARS
      ? [
          {
            id: row.id,
            role: row.role,
            body,
            sequence: row.sequence,
            ...(row.userRecordedAt ? { recordedAt: row.userRecordedAt } : {}),
          },
        ]
      : [];
  });
  return {
    checkpointId,
    sessionId: checkpoint.sessionId,
    throughSequence: checkpoint.throughSequence,
    messages,
    sourceMessageIds: messages.filter(({ role }) => role === "user").map(({ id }) => id),
  };
}

/** 検証済み候補とEvidenceを保存し、同じbatchでcheckpointを完了する。 */
export async function applyDiaryBrainCheckpoint(
  db: AccountDataDatabase,
  accountId: string,
  checkpointId: string,
  expectedThroughSequence: number,
  promptVersion: string,
  candidates: readonly DiaryBrainCheckpointCandidate[],
  at = new Date(),
): Promise<DiaryBrainCheckpointApplyResult | false> {
  const context = await getDiaryBrainCheckpointContext(db, accountId, checkpointId);
  if (!context || context.throughSequence !== expectedThroughSequence) return false;
  const checkpoint = await db
    .select()
    .from(diaryBrainCheckpoints)
    .where(eq(diaryBrainCheckpoints.id, checkpointId))
    .get();
  if (!checkpoint) return false;
  if (candidates.length > 3) throw new Error("Diary Brain candidates exceed the limit");
  const statements: BatchItem<"sqlite">[] = [];
  const appliedCandidates: AppliedDiaryBrainCheckpointCandidate[] = [];
  const appliedCandidateIndexByItemId = new Map<string, number>();
  const scheduledSupersededItemIds = new Set<string>();
  const groupedCandidates = new Map<string, DiaryBrainCheckpointCandidate>();
  for (const candidate of candidates) {
    const promptContext = candidate.promptContext
      ? parsePromptContext(candidate.promptContext)
      : undefined;
    const messageIds = [...new Set(candidate.sourceMessageIds)];
    const evidenceStatements =
      candidate.evidenceStatements ??
      messageIds.map((sourceMessageId) => ({
        sourceMessageId,
        statement: candidate.statement,
      }));
    const evidenceMessageIds = new Set(
      evidenceStatements.map(({ sourceMessageId }) => sourceMessageId),
    );
    const deduplication = candidate.deduplication ?? "none";
    const hasMatch = Boolean(candidate.matchingBrainItemId);
    const hasValidDedupAudit =
      (deduplication === "semantic"
        ? Boolean(candidate.dedupPromptVersion?.trim())
        : !candidate.dedupPromptVersion) &&
      (!hasMatch || deduplication !== "none");
    if (
      !DIARY_BRAIN_CATEGORY_SET.has(candidate.category) ||
      !candidate.statement.trim() ||
      (candidate.promptContext && !promptContext) ||
      (candidate.category === "identity" && promptContext?.kind !== "occupation") ||
      (promptContext &&
        !isPromptContextGrounded(
          candidate.category,
          candidate.statement,
          promptContext,
          findPrecedingAssistantBodies(context.messages, messageIds),
        )) ||
      messageIds.length === 0 ||
      messageIds.length !== candidate.sourceMessageIds.length ||
      evidenceStatements.length !== messageIds.length ||
      evidenceMessageIds.size !== messageIds.length ||
      !messageIds.every((messageId) => evidenceMessageIds.has(messageId)) ||
      evidenceStatements.some(({ statement }) => !statement.trim()) ||
      !hasValidDedupAudit
    ) {
      throw new Error("Diary Brain candidate validation failed");
    }
    const key = `${candidate.category}\u0000${candidate.statement.trim()}`;
    const grouped = groupedCandidates.get(key);
    if (!grouped) {
      groupedCandidates.set(key, {
        ...candidate,
        ...(promptContext ? { promptContext } : {}),
        statement: candidate.statement.trim(),
        evidenceStatements,
      });
      continue;
    }
    if (
      grouped.promptContext &&
      promptContext &&
      !arePromptContextsEqual(grouped.promptContext, promptContext)
    ) {
      continue;
    }
    const sameMatch = grouped.matchingBrainItemId === candidate.matchingBrainItemId;
    groupedCandidates.set(key, {
      category: grouped.category,
      statement: grouped.statement,
      ...(grouped.promptContext || candidate.promptContext
        ? { promptContext: grouped.promptContext ?? candidate.promptContext }
        : {}),
      sourceMessageIds: [...new Set([...grouped.sourceMessageIds, ...messageIds])],
      evidenceStatements: [
        ...(grouped.evidenceStatements ?? []),
        ...evidenceStatements.filter(
          ({ sourceMessageId }) =>
            !grouped.evidenceStatements?.some(
              (groupedEvidence) => groupedEvidence.sourceMessageId === sourceMessageId,
            ),
        ),
      ],
      ...(sameMatch && grouped.matchingBrainItemId
        ? { matchingBrainItemId: grouped.matchingBrainItemId }
        : {}),
      ...(sameMatch && grouped.deduplication
        ? {
            deduplication: grouped.deduplication,
            ...(grouped.dedupPromptVersion
              ? { dedupPromptVersion: grouped.dedupPromptVersion }
              : {}),
          }
        : {}),
    });
  }

  for (const candidate of groupedCandidates.values()) {
    const messageIds = [...candidate.sourceMessageIds];
    const evidenceStatementByMessageId = new Map(
      candidate.evidenceStatements?.map(({ sourceMessageId, statement }) => [
        sourceMessageId,
        statement.trim(),
      ]),
    );
    const sources = await db
      .select({
        id: sourceRecords.id,
        messageId: conversationMessages.id,
        createdAt: sourceRecords.createdAt,
        body: sourceRecordTextPayloads.body,
      })
      .from(conversationMessages)
      .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
      .innerJoin(
        sourceRecordTextPayloads,
        eq(sourceRecords.id, sourceRecordTextPayloads.sourceRecordId),
      )
      .where(
        and(
          eq(conversationMessages.sessionId, checkpoint.sessionId),
          inArray(conversationMessages.id, messageIds),
          gte(conversationMessages.sequence, checkpoint.fromSequence),
          lte(conversationMessages.sequence, checkpoint.throughSequence),
          eq(conversationMessages.role, "user"),
          eq(sourceRecords.accountId, accountId),
          eq(sourceRecords.isDeleted, false),
        ),
      )
      .all();
    if (
      sources.length !== messageIds.length ||
      sources.some(({ messageId, body }) => {
        const evidenceStatement = evidenceStatementByMessageId.get(messageId);
        return (
          body.length > BRAIN_CHECKPOINT_MAX_USER_MESSAGE_CHARS ||
          evidenceStatement === undefined ||
          !normalizeDiaryBrainEvidenceText(body).includes(
            normalizeDiaryBrainEvidenceText(evidenceStatement),
          )
        );
      })
    ) {
      throw new Error("Diary Brain candidate evidence validation failed");
    }
    const recordedAt = new Date(Math.min(...sources.map(({ createdAt }) => createdAt.getTime())));
    const statement = candidate.statement.trim();
    const temporalContext = resolveDiaryTemporalContext(statement, recordedAt);
    const lifecycle = { createdAt: at, updatedAt: at };
    const requestedItem = candidate.matchingBrainItemId
      ? await db
          .select({
            id: brainItems.id,
            category: brainItems.category,
            statement: brainItems.statement,
            attributes: brainItems.attributes,
            derivation: brainItems.derivation,
          })
          .from(brainItems)
          .where(
            and(
              eq(brainItems.id, candidate.matchingBrainItemId),
              eq(brainItems.accountId, accountId),
              eq(brainItems.status, "active"),
              eq(brainItems.isDeleted, false),
            ),
          )
          .get()
      : undefined;
    const requestedIsInference =
      requestedItem?.attributes &&
      typeof requestedItem.attributes === "object" &&
      "isInference" in requestedItem.attributes &&
      typeof requestedItem.attributes.isInference === "boolean"
        ? requestedItem.attributes.isInference
        : requestedItem?.derivation === "ai";
    const requestedTemporalContext = readDiaryTemporalContext(requestedItem?.attributes);
    const requestedPromptContext = readPromptContext(requestedItem?.attributes);
    const requestedPromptContextConflicts = Boolean(
      candidate.promptContext &&
        requestedPromptContext &&
        !arePromptContextsEqual(candidate.promptContext, requestedPromptContext),
    );
    const requestedDeduplicationIsValid =
      candidate.deduplication === "semantic" ||
      (candidate.deduplication === "exact" &&
        requestedItem &&
        normalizeDiaryBrainComparison(
          buildDiaryTemporalSearchText(requestedItem.statement, requestedTemporalContext),
        ) ===
          normalizeDiaryBrainComparison(buildDiaryTemporalSearchText(statement, temporalContext)));
    const requestedMatch =
      requestedItem &&
      requestedDeduplicationIsValid &&
      requestedItem.category === candidate.category &&
      !requestedIsInference &&
      !temporalContextsConflict(temporalContext, requestedTemporalContext) &&
      !requestedPromptContextConflicts
        ? requestedItem
        : undefined;
    if (candidate.matchingBrainItemId && !requestedMatch && !requestedPromptContextConflicts) {
      throw new Error("Diary Brain requested match revalidation failed");
    }
    const exactItems = requestedMatch
      ? []
      : await db
          .select({
            id: brainItems.id,
            category: brainItems.category,
            statement: brainItems.statement,
            attributes: brainItems.attributes,
            derivation: brainItems.derivation,
          })
          .from(brainItems)
          .where(
            and(
              eq(brainItems.accountId, accountId),
              eq(brainItems.category, candidate.category),
              eq(brainItems.statement, statement),
              eq(brainItems.status, "active"),
              eq(brainItems.isDeleted, false),
            ),
          )
          .all();
    const exactMatch = exactItems.find((item) => {
      const itemPromptContext = readPromptContext(item.attributes);
      const isInference =
        item.attributes &&
        typeof item.attributes === "object" &&
        "isInference" in item.attributes &&
        typeof item.attributes.isInference === "boolean"
          ? item.attributes.isInference
          : item.derivation === "ai";
      return (
        !isInference &&
        !temporalContextsConflict(temporalContext, readDiaryTemporalContext(item.attributes)) &&
        (!candidate.promptContext ||
          !itemPromptContext ||
          arePromptContextsEqual(candidate.promptContext, itemPromptContext))
      );
    });
    const promptContextItems = candidate.promptContext
      ? await db
          .select({
            id: brainItems.id,
            category: brainItems.category,
            statement: brainItems.statement,
            attributes: brainItems.attributes,
            derivation: brainItems.derivation,
          })
          .from(brainItems)
          .where(
            and(
              eq(brainItems.accountId, accountId),
              eq(brainItems.category, candidate.category),
              eq(brainItems.status, "active"),
              eq(brainItems.isDeleted, false),
            ),
          )
          .all()
      : [];
    const candidatePromptContext = candidate.promptContext;
    const promptContextMatch = candidatePromptContext
      ? promptContextItems.find((item) => {
          const itemPromptContext = readPromptContext(item.attributes);
          const isInference =
            item.attributes &&
            typeof item.attributes === "object" &&
            "isInference" in item.attributes &&
            typeof item.attributes.isInference === "boolean"
              ? item.attributes.isInference
              : item.derivation === "ai";
          return (
            !isInference &&
            itemPromptContext &&
            arePromptContextsEqual(candidatePromptContext, itemPromptContext) &&
            !temporalContextsConflict(temporalContext, readDiaryTemporalContext(item.attributes))
          );
        })
      : undefined;
    const matchedItem = requestedMatch ?? exactMatch ?? promptContextMatch;
    const supersededItems =
      !matchedItem &&
      candidate.promptContext &&
      isRevisionedPromptContextKind(candidate.promptContext.kind)
        ? promptContextItems.filter((item) => {
            const itemPromptContext = readPromptContext(item.attributes);
            if (
              !itemPromptContext ||
              itemPromptContext.kind !== candidate.promptContext?.kind ||
              arePromptContextsEqual(candidate.promptContext, itemPromptContext)
            ) {
              return false;
            }
            const isInference =
              item.attributes &&
              typeof item.attributes === "object" &&
              "isInference" in item.attributes &&
              typeof item.attributes.isInference === "boolean"
                ? item.attributes.isInference
                : item.derivation === "ai";
            return !isInference && !scheduledSupersededItemIds.has(item.id);
          })
        : [];
    for (const item of supersededItems) scheduledSupersededItemIds.add(item.id);
    const actualDeduplication = requestedMatch
      ? (candidate.deduplication ?? "none")
      : exactMatch
        ? "exact"
        : "none";

    if (matchedItem) {
      const brainItemId = matchedItem.id;
      const existingPromptContext = readPromptContext(matchedItem.attributes);
      if (candidate.promptContext && !existingPromptContext) {
        const existingAttributes =
          matchedItem.attributes && typeof matchedItem.attributes === "object"
            ? matchedItem.attributes
            : {};
        statements.push(
          db
            .update(brainItems)
            .set({
              attributes: {
                ...existingAttributes,
                promptContext: candidate.promptContext,
                promptContextPromptVersion: promptVersion,
              },
              updatedAt: at,
            })
            .where(
              and(
                eq(brainItems.id, brainItemId),
                eq(brainItems.accountId, accountId),
                eq(brainItems.status, "active"),
                eq(brainItems.isDeleted, false),
              ),
            ),
        );
      }
      statements.push(
        ...sources.flatMap((source) => {
          const evidenceId = crypto.randomUUID();
          return [
            db
              .insert(brainItemEvidenceEdges)
              .values({
                id: evidenceId,
                brainItemId,
                sourceRecordId: source.id,
                relation: "supports",
                isDerivationTrigger: false,
                derivationMethod: "ai",
                generatedAt: at,
                ...lifecycle,
              })
              .onConflictDoNothing(),
            progressionPendingStatement(db, {
              accountId,
              originType: "evidence",
              originId: evidenceId,
              at,
            }),
          ];
        }),
      );
      const appliedIndex = appliedCandidateIndexByItemId.get(brainItemId);
      if (appliedIndex !== undefined) {
        const previous = appliedCandidates[appliedIndex];
        if (previous) {
          appliedCandidates[appliedIndex] = {
            ...previous,
            sourceMessageIds: [...new Set([...previous.sourceMessageIds, ...messageIds])],
            ...(actualDeduplication === "semantic" ? { deduplication: "semantic" as const } : {}),
          };
          if (previous.deduplication !== "semantic" && actualDeduplication === "semantic") {
            statements.push(
              db
                .update(diaryBrainCheckpointItems)
                .set({
                  deduplication: "semantic",
                  dedupPromptVersion: candidate.dedupPromptVersion,
                  updatedAt: at,
                })
                .where(
                  and(
                    eq(diaryBrainCheckpointItems.checkpointId, checkpointId),
                    eq(diaryBrainCheckpointItems.brainItemId, brainItemId),
                  ),
                ),
            );
          }
        }
        continue;
      }
      statements.push(
        db.insert(diaryBrainCheckpointItems).values({
          id: crypto.randomUUID(),
          checkpointId,
          brainItemId,
          position: appliedCandidates.length,
          operation: "evidence_added",
          deduplication: actualDeduplication,
          ...(actualDeduplication === "semantic" && candidate.dedupPromptVersion
            ? { dedupPromptVersion: candidate.dedupPromptVersion }
            : {}),
          ...lifecycle,
        }),
      );
      appliedCandidateIndexByItemId.set(brainItemId, appliedCandidates.length);
      appliedCandidates.push({
        category: candidate.category,
        statement: matchedItem.statement,
        sourceMessageIds: messageIds,
        operation: "evidence_added",
        deduplication: actualDeduplication,
      });
      continue;
    }

    const brainItemId = crypto.randomUUID();
    statements.push(
      db.insert(brainItems).values({
        id: brainItemId,
        accountId,
        category: candidate.category,
        statement,
        attributes: {
          sourceKind: "diary",
          sessionId: checkpoint.sessionId,
          checkpointId,
          promptVersion,
          isInference: false,
          ...(candidate.promptContext ? { promptContext: candidate.promptContext } : {}),
          ...(candidate.promptContext ? { promptContextPromptVersion: promptVersion } : {}),
          ...(temporalContext ? { temporalContext } : {}),
        },
        derivation: "ai",
        status: "active",
        validFrom: recordedAt,
        stability: DIARY_BRAIN_STABILITY[candidate.category],
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
        ...lifecycle,
      }),
      progressionPendingStatement(db, {
        accountId,
        originType: "brain_item",
        originId: brainItemId,
        at,
      }),
      db.insert(brainVectorSyncJobs).values({
        id: `${brainItemId}:${at.getTime()}:upsert`,
        brainItemId,
        itemRevision: at.getTime(),
        operation: "upsert",
        status: "pending",
        nextAttemptAt: at,
        ...lifecycle,
      }),
      ...sources.flatMap((source) => {
        const evidenceId = crypto.randomUUID();
        return [
          db.insert(brainItemEvidenceEdges).values({
            id: evidenceId,
            brainItemId,
            sourceRecordId: source.id,
            relation: "supports",
            isDerivationTrigger: true,
            derivationMethod: "ai",
            generatedAt: at,
            ...lifecycle,
          }),
          progressionPendingStatement(db, {
            accountId,
            originType: "evidence",
            originId: evidenceId,
            at,
          }),
        ];
      }),
      db.insert(brainItemAccessLabels).values({
        id: crypto.randomUUID(),
        brainItemId,
        label: "unclassified",
        assignedBy: "system",
        ...lifecycle,
      }),
      db.insert(brainItemTopicLabels).values({
        id: crypto.randomUUID(),
        brainItemId,
        label: "diary",
        ...lifecycle,
      }),
      ...supersededItems.flatMap((item) => [
        db
          .update(brainItems)
          .set({ status: "superseded", updatedAt: at })
          .where(
            and(
              eq(brainItems.id, item.id),
              eq(brainItems.accountId, accountId),
              eq(brainItems.status, "active"),
              eq(brainItems.isDeleted, false),
            ),
          ),
        db.insert(brainItemRevisions).values({
          id: crypto.randomUUID(),
          previousBrainItemId: item.id,
          nextBrainItemId: brainItemId,
          derivationMethod: "ai",
          ...lifecycle,
        }),
        db.insert(brainVectorSyncJobs).values({
          id: `${item.id}:${at.getTime()}:delete`,
          brainItemId: item.id,
          itemRevision: at.getTime(),
          operation: "delete",
          status: "pending",
          nextAttemptAt: at,
          ...lifecycle,
        }),
      ]),
      db.insert(diaryBrainCheckpointItems).values({
        id: crypto.randomUUID(),
        checkpointId,
        brainItemId,
        position: appliedCandidates.length,
        operation: "created",
        deduplication: candidate.deduplication ?? "none",
        ...(candidate.deduplication === "semantic" && candidate.dedupPromptVersion
          ? { dedupPromptVersion: candidate.dedupPromptVersion }
          : {}),
        ...lifecycle,
      }),
    );
    appliedCandidateIndexByItemId.set(brainItemId, appliedCandidates.length);
    appliedCandidates.push({
      category: candidate.category,
      statement,
      sourceMessageIds: messageIds,
      operation: "created",
      deduplication: candidate.deduplication ?? "none",
    });
  }
  statements.push(
    db
      .update(diaryBrainCheckpoints)
      .set({ status: "applied", appliedAt: at, updatedAt: at })
      .where(
        and(
          eq(diaryBrainCheckpoints.id, checkpointId),
          inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
          inArray(diaryBrainCheckpoints.status, ["queued", "dispatched"]),
          eq(diaryBrainCheckpoints.throughSequence, expectedThroughSequence),
        ),
      ),
  );
  const [first, ...rest] = statements;
  if (!first) return false;
  await db.batch([first, ...rest]);
  return { candidates: appliedCandidates };
}

/** 未送信のdev通知向けに、実際に保存したItemとEvidence message IDを返す。 */
export async function getDiaryBrainCheckpointDevelopmentNotification(
  db: AccountDataDatabase,
  accountId: string,
  checkpointId: string,
): Promise<DiaryBrainCheckpointApplyResult | undefined> {
  const checkpoint = await db
    .select({
      id: diaryBrainCheckpoints.id,
      sessionId: diaryBrainCheckpoints.sessionId,
      fromSequence: diaryBrainCheckpoints.fromSequence,
      throughSequence: diaryBrainCheckpoints.throughSequence,
    })
    .from(diaryBrainCheckpoints)
    .where(
      and(
        eq(diaryBrainCheckpoints.id, checkpointId),
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        eq(diaryBrainCheckpoints.status, "applied"),
        isNull(diaryBrainCheckpoints.developmentNotificationSentAt),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .get();
  if (!checkpoint) return undefined;
  const items = await db
    .select({
      brainItemId: brainItems.id,
      category: brainItems.category,
      statement: brainItems.statement,
      operation: diaryBrainCheckpointItems.operation,
      deduplication: diaryBrainCheckpointItems.deduplication,
    })
    .from(diaryBrainCheckpointItems)
    .innerJoin(brainItems, eq(diaryBrainCheckpointItems.brainItemId, brainItems.id))
    .where(
      and(
        eq(diaryBrainCheckpointItems.checkpointId, checkpointId),
        eq(diaryBrainCheckpointItems.isDeleted, false),
        eq(brainItems.accountId, accountId),
      ),
    )
    .orderBy(diaryBrainCheckpointItems.position)
    .all();
  const result: AppliedDiaryBrainCheckpointCandidate[] = [];
  for (const item of items) {
    const messages = await db
      .select({ id: conversationMessages.id })
      .from(brainItemEvidenceEdges)
      .innerJoin(
        conversationMessages,
        eq(brainItemEvidenceEdges.sourceRecordId, conversationMessages.sourceRecordId),
      )
      .where(
        and(
          eq(brainItemEvidenceEdges.brainItemId, item.brainItemId),
          eq(brainItemEvidenceEdges.isDeleted, false),
          eq(conversationMessages.sessionId, checkpoint.sessionId),
          gte(conversationMessages.sequence, checkpoint.fromSequence),
          lte(conversationMessages.sequence, checkpoint.throughSequence),
        ),
      )
      .orderBy(conversationMessages.sequence)
      .all();
    if (!DIARY_BRAIN_CATEGORY_SET.has(item.category)) continue;
    result.push({
      category: item.category as DiaryBrainCategory,
      statement: item.statement,
      sourceMessageIds: messages.map(({ id }) => id),
      operation: item.operation,
      deduplication: item.deduplication,
    });
  }
  return { candidates: result };
}

export async function markDiaryBrainCheckpointDevelopmentNotificationSent(
  db: AccountDataDatabase,
  accountId: string,
  checkpointId: string,
  at = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(diaryBrainCheckpoints)
    .set({ developmentNotificationSentAt: at, updatedAt: at })
    .where(
      and(
        eq(diaryBrainCheckpoints.id, checkpointId),
        inArray(diaryBrainCheckpoints.sessionId, ownedSessionIds(db, accountId)),
        eq(diaryBrainCheckpoints.status, "applied"),
        isNull(diaryBrainCheckpoints.developmentNotificationSentAt),
      ),
    )
    .returning({ id: diaryBrainCheckpoints.id })
    .all();
  return updated.length > 0;
}

export async function markTurnGenerating(
  db: AccountDataDatabase,
  turnId: string,
): Promise<boolean> {
  const updated = await db
    .update(chatTurns)
    .set({
      status: "generating",
      generationStartedAt: new Date(),
      attemptCount: sql`${chatTurns.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(chatTurns.id, turnId), inArray(chatTurns.status, ["queued", "generating"])))
    .returning({ id: chatTurns.id })
    .all();
  return updated.length > 0;
}

export async function getTurnStatus(
  db: AccountDataDatabase,
  turnId: string,
): Promise<(typeof chatTurns.$inferSelect)["status"] | undefined> {
  const row = await db
    .select({ status: chatTurns.status })
    .from(chatTurns)
    .where(eq(chatTurns.id, turnId))
    .get();
  return row?.status;
}

/** 配送直前にTurnが属するSessionの有効性を再確認する。 */
export async function isTurnSessionActive(
  db: AccountDataDatabase,
  turnId: string,
): Promise<boolean> {
  return Boolean(
    await db
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .innerJoin(conversationSessions, eq(chatTurns.sessionId, conversationSessions.id))
      .where(and(eq(chatTurns.id, turnId), eq(conversationSessions.status, "active")))
      .get(),
  );
}

export async function saveAssistantResponse(
  db: AccountDataDatabase,
  accountId: string,
  input: {
    turnId: string;
    body: string;
    endSession: boolean;
    dailyPromptFollowUp?: DailyPromptSameDayContext;
    collectionTarget?: PromptContextCollectionTarget;
    brainUsages?: readonly Readonly<{
      brainItemId: string;
      sourceRecordIds: readonly string[];
    }>[];
  },
): Promise<string> {
  const turn = await db
    .select()
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.id, input.turnId),
        inArray(chatTurns.status, ["generating", "validated", "delivery_pending"]),
      ),
    )
    .get();
  if (!turn?.sessionId) throw new Error("Chat turn is not ready for an assistant response");
  if (turn.responseMessageId) return turn.responseMessageId;
  const collectionTarget = input.collectionTarget
    ? parsePromptContextCollectionTarget(
        input.collectionTarget.themeId,
        input.collectionTarget.kind,
      )
    : undefined;
  if (input.collectionTarget && !collectionTarget) {
    throw new Error("Diary chat collection target is not defined by the collection theme master");
  }

  const session = await db
    .select()
    .from(conversationSessions)
    .where(eq(conversationSessions.id, turn.sessionId))
    .get();
  if (!session) throw new Error("Conversation session was not found");
  if (session.accountId !== accountId) throw new Error("Conversation account mismatch");
  if (input.dailyPromptFollowUp && !input.endSession) {
    throw new Error("Daily prompt follow-up requires the Conversation Session to end");
  }
  if (collectionTarget) {
    const askedTargets = await listCollectionAskedTargets(db, session.id);
    const candidates = buildPromptContextCollectionCandidates({
      collectedKinds: [],
      askedTargets,
    });
    const allowed = candidates.some(
      ({ themeId, kinds }) =>
        themeId === collectionTarget.themeId && kinds.includes(collectionTarget.kind),
    );
    if (!allowed) {
      throw new Error("Diary chat collection target exceeds the Session collection goal");
    }
  }
  const brainUsages = input.brainUsages ?? [];
  const brainItemIds = brainUsages.map(({ brainItemId }) => brainItemId);
  const evidenceSourceRecordIds = brainUsages.flatMap(({ sourceRecordIds }) => sourceRecordIds);
  if (
    brainUsages.length > 5 ||
    new Set(brainItemIds).size !== brainItemIds.length ||
    evidenceSourceRecordIds.length > 3
  ) {
    throw new Error("Diary chat Brain usage exceeds the Context Package limits");
  }
  const messageId = crypto.randomUUID();
  const now = new Date();
  const statements: BatchItem<"sqlite">[] = [
    db.insert(conversationMessages).values({
      id: messageId,
      sessionId: session.id,
      sequence: session.nextSequence,
      role: "assistant",
      assistantBody: input.body,
      channel: "line",
      turnId: input.turnId,
      createdAt: now,
      updatedAt: now,
    }),
    db
      .update(conversationSessions)
      .set({ nextSequence: session.nextSequence + 1, lastAssistantMessageAt: now, updatedAt: now })
      .where(eq(conversationSessions.id, session.id)),
    db
      .update(chatTurns)
      .set({
        status: "delivery_pending",
        responseMessageId: messageId,
        endSession: input.endSession,
        dailyPromptFollowUp: input.dailyPromptFollowUp,
        collectionThemeId: collectionTarget?.themeId,
        collectionKind: collectionTarget?.kind,
        finalReplyRequestedAt: now,
        updatedAt: now,
      })
      .where(eq(chatTurns.id, input.turnId)),
  ];
  for (const usage of brainUsages) {
    const item = await db
      .select({
        id: brainItems.id,
        status: brainItems.status,
        derivation: brainItems.derivation,
        confidence: brainItems.confidence,
      })
      .from(brainItems)
      .where(and(eq(brainItems.id, usage.brainItemId), eq(brainItems.accountId, accountId)))
      .get();
    if (!item) throw new Error("Diary chat Brain usage account mismatch");
    const labels = await db
      .select({ label: brainItemAccessLabels.label })
      .from(brainItemAccessLabels)
      .where(
        and(
          eq(brainItemAccessLabels.brainItemId, item.id),
          eq(brainItemAccessLabels.isDeleted, false),
        ),
      )
      .all();
    const uniqueSourceRecordIds = [...new Set(usage.sourceRecordIds)];
    if (uniqueSourceRecordIds.length !== usage.sourceRecordIds.length) {
      throw new Error("Diary chat Brain usage contains duplicate Evidence");
    }
    const evidence =
      uniqueSourceRecordIds.length === 0
        ? []
        : await db
            .select({ sourceRecordId: sourceRecords.id })
            .from(brainItemEvidenceEdges)
            .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
            .where(
              and(
                eq(brainItemEvidenceEdges.brainItemId, item.id),
                eq(brainItemEvidenceEdges.relation, "supports"),
                eq(brainItemEvidenceEdges.isDeleted, false),
                inArray(sourceRecords.id, uniqueSourceRecordIds),
                eq(sourceRecords.accountId, accountId),
                eq(sourceRecords.isDeleted, false),
              ),
            )
            .all();
    if (evidence.length !== uniqueSourceRecordIds.length) {
      throw new Error("Diary chat Brain usage Evidence is not authorized");
    }
    statements.push(
      db.insert(diaryChatBrainUsageAudits).values({
        id: crypto.randomUUID(),
        turnId: input.turnId,
        brainItemId: item.id,
        purpose: "diary_chat",
        status: item.status,
        derivation: item.derivation,
        confidence: item.confidence,
        accessLabels: labels.map(({ label }) => label).sort(),
        sourceRecordIds: uniqueSourceRecordIds,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  if (input.endSession) {
    statements.push(
      db
        .update(diaryBrainCheckpoints)
        .set({ dueAt: now, nextAttemptAt: now, updatedAt: now })
        .where(
          and(
            eq(diaryBrainCheckpoints.sessionId, session.id),
            eq(diaryBrainCheckpoints.status, "pending"),
            eq(diaryBrainCheckpoints.isDeleted, false),
          ),
        ),
    );
  }

  const [firstStatement, ...remainingStatements] = statements;
  if (!firstStatement) throw new Error("Assistant response did not produce any D1 writes");
  await db.batch([firstStatement, ...remainingStatements]);
  return messageId;
}

export async function getPendingAssistantResponse(
  db: AccountDataDatabase,
  accountId: string,
  turnId: string,
): Promise<
  | {
      body: string;
      endSession: boolean;
      usedBrainItems: readonly { category: string; statement: string }[];
    }
  | undefined
> {
  const row = await db
    .select({
      body: conversationMessages.assistantBody,
      endSession: chatTurns.endSession,
    })
    .from(chatTurns)
    .innerJoin(conversationSessions, eq(chatTurns.sessionId, conversationSessions.id))
    .innerJoin(
      conversationMessages,
      and(
        eq(chatTurns.responseMessageId, conversationMessages.id),
        eq(conversationMessages.sessionId, chatTurns.sessionId),
        eq(conversationMessages.turnId, chatTurns.id),
      ),
    )
    .where(
      and(
        eq(chatTurns.id, turnId),
        eq(chatTurns.status, "delivery_pending"),
        eq(conversationSessions.accountId, accountId),
      ),
    )
    .get();
  if (!row?.body) return undefined;
  const usedBrainItems = await db
    .select({ category: brainItems.category, statement: brainItems.statement })
    .from(diaryChatBrainUsageAudits)
    .innerJoin(brainItems, eq(brainItems.id, diaryChatBrainUsageAudits.brainItemId))
    .where(
      and(
        eq(diaryChatBrainUsageAudits.turnId, turnId),
        eq(diaryChatBrainUsageAudits.purpose, "diary_chat"),
        eq(diaryChatBrainUsageAudits.isDeleted, false),
        eq(brainItems.accountId, accountId),
      ),
    )
    .orderBy(asc(brainItems.category), asc(brainItems.statement), asc(brainItems.id))
    .all();
  return {
    body: row.body,
    endSession: row.endSession,
    usedBrainItems,
  };
}

export async function closeTurnSession(db: AccountDataDatabase, turnId: string): Promise<void> {
  const turn = await db
    .select({ sessionId: chatTurns.sessionId })
    .from(chatTurns)
    .where(eq(chatTurns.id, turnId))
    .get();
  if (!turn) return;
  const now = new Date();
  await db
    .update(conversationSessions)
    .set({ status: "closed", closeReason: "explicit", closedAt: now, updatedAt: now })
    .where(
      and(eq(conversationSessions.id, turn.sessionId), eq(conversationSessions.status, "active")),
    )
    .run();
}

export async function closeExpiredSessions(
  db: AccountDataDatabase,
  now = new Date(),
): Promise<number> {
  const inactiveCutoff = new Date(now.getTime() - SESSION_INACTIVITY_MS);
  const hardCapCutoff = new Date(now.getTime() - SESSION_HARD_CAP_MS);
  const hardCapRows = await db
    .update(conversationSessions)
    .set({ status: "closed", closeReason: "hard_cap", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationSessions.status, "active"),
        lte(conversationSessions.startedAt, hardCapCutoff),
      ),
    )
    .returning({ id: conversationSessions.id })
    .all();
  const inactiveRows = await db
    .update(conversationSessions)
    .set({ status: "closed", closeReason: "inactive", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationSessions.status, "active"),
        lte(conversationSessions.lastUserMessageAt, inactiveCutoff),
      ),
    )
    .returning({ id: conversationSessions.id })
    .all();
  return hardCapRows.length + inactiveRows.length;
}

export async function markTurnDelivered(db: AccountDataDatabase, turnId: string): Promise<boolean> {
  const turn = await db
    .select({
      sessionId: chatTurns.sessionId,
      status: chatTurns.status,
      endSession: chatTurns.endSession,
    })
    .from(chatTurns)
    .where(eq(chatTurns.id, turnId))
    .get();
  if (!turn) return false;
  if (turn.status === "delivered") return true;
  if (turn.status !== "delivery_pending") return false;

  const now = new Date();
  const deliveryMetricToken = crypto.randomUUID();
  const writes: BatchItem<"sqlite">[] = [
    db
      .update(chatTurns)
      .set({ status: "delivered", deliveryMetricToken, updatedAt: now })
      .where(and(eq(chatTurns.id, turnId), eq(chatTurns.status, "delivery_pending"))),
  ];
  if (!turn.endSession) {
    writes.push(
      db
        .update(conversationSessions)
        .set({
          replyOpportunityCount: sql`${conversationSessions.replyOpportunityCount} + 1`,
          awaitingReply: true,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationSessions.id, turn.sessionId),
            sql`EXISTS (
              SELECT 1 FROM ${chatTurns}
              WHERE ${chatTurns.id} = ${turnId}
                AND ${chatTurns.deliveryMetricToken} = ${deliveryMetricToken}
            )`,
          ),
        ),
    );
  }
  const [firstWrite, ...remainingWrites] = writes;
  if (!firstWrite) return false;
  await db.batch([firstWrite, ...remainingWrites]);
  return Boolean(
    await db
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .where(and(eq(chatTurns.id, turnId), eq(chatTurns.status, "delivered")))
      .get(),
  );
}

export async function markTurnFailed(
  db: AccountDataDatabase,
  turnId: string,
  failureStage: string,
): Promise<boolean> {
  const updated = await db
    .update(chatTurns)
    .set({ status: "failed", failureStage, updatedAt: new Date() })
    .where(
      and(eq(chatTurns.id, turnId), inArray(chatTurns.status, ["generating", "delivery_pending"])),
    )
    .returning({ id: chatTurns.id })
    .all();
  if (updated.length > 0) return true;
  return Boolean(
    await db
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .where(and(eq(chatTurns.id, turnId), eq(chatTurns.status, "failed")))
      .get(),
  );
}
