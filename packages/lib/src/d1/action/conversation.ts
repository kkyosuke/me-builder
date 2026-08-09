import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { D1Client } from "../client";
import {
  brainItemAccessLabels,
  brainItemEvidenceEdges,
  brainItemTopicLabels,
  brainItems,
  chatTurns,
  conversationMessages,
  conversationSessions,
  diaryBrainCheckpoints,
  sourceRecordTextPayloads,
  sourceRecords,
} from "../schema";

const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;
const BRAIN_CHECKPOINT_INACTIVITY_MS = 10 * 60 * 1000;
const BRAIN_CHECKPOINT_HARD_CAP_MS = 30 * 60 * 1000;
const CONVERSATION_POLICY_EXPLORATION_RATE = 0.2;

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
  db: D1Client,
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

/** LINE eventを不変なSource Recordとして冪等に保存する。 */
export async function storeLineTextSource(
  db: D1Client,
  input: { accountId: string; eventId: string; body: string; receivedAt: Date },
): Promise<StoredLineSource> {
  const originalRef = `line:${input.eventId}`;
  const existing = await db
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(
      and(eq(sourceRecords.accountId, input.accountId), eq(sourceRecords.originalRef, originalRef)),
    )
    .get();
  const sourceRecordId =
    existing?.id ?? `line-${await sha256(`${input.accountId}:${input.eventId}`)}`;
  const now = new Date();

  await db.batch([
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
  ]);

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

/** Coordinatorが予約した順序でuser messageをSessionへ追加し、1 Turnを作る。 */
export async function attachMessagesToTurn(
  db: D1Client,
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
    pendingBrainCheckpoint
      ? db
          .update(diaryBrainCheckpoints)
          .set({
            throughSequence,
            lastMessageAt: lastReceivedAt,
            dueAt: new Date(
              Math.min(
                pendingBrainCheckpoint.firstMessageAt.getTime() + BRAIN_CHECKPOINT_HARD_CAP_MS,
                lastReceivedAt.getTime() + BRAIN_CHECKPOINT_INACTIVITY_MS,
              ),
            ),
            nextAttemptAt: new Date(
              Math.min(
                pendingBrainCheckpoint.firstMessageAt.getTime() + BRAIN_CHECKPOINT_HARD_CAP_MS,
                lastReceivedAt.getTime() + BRAIN_CHECKPOINT_INACTIVITY_MS,
              ),
            ),
            updatedAt: now,
          })
          .where(eq(diaryBrainCheckpoints.id, pendingBrainCheckpoint.id))
      : db.insert(diaryBrainCheckpoints).values({
          id: crypto.randomUUID(),
          accountId,
          sessionId: session.id,
          fromSequence,
          throughSequence,
          firstMessageAt: firstReceivedAt,
          lastMessageAt: lastReceivedAt,
          dueAt: new Date(
            Math.min(
              firstReceivedAt.getTime() + BRAIN_CHECKPOINT_HARD_CAP_MS,
              lastReceivedAt.getTime() + BRAIN_CHECKPOINT_INACTIVITY_MS,
            ),
          ),
          nextAttemptAt: new Date(
            Math.min(
              firstReceivedAt.getTime() + BRAIN_CHECKPOINT_HARD_CAP_MS,
              lastReceivedAt.getTime() + BRAIN_CHECKPOINT_INACTIVITY_MS,
            ),
          ),
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
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
};

/** Turnと同じSessionの直近messageを、Account所有権を含むjoinで取得する。 */
export async function getTurnContext(
  db: D1Client,
  turnId: string,
  messageLimit: number,
): Promise<
  | {
      accountId: string;
      conversationPolicyId: string;
      messages: ConversationContextMessage[];
      currentUserMessageIds: string[];
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

  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      sequence: conversationMessages.sequence,
      assistantBody: conversationMessages.assistantBody,
      userBody: sourceRecordTextPayloads.body,
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
    return body ? [{ id: row.id, role: row.role, body, sequence: row.sequence }] : [];
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
  };
}

export type DiaryBrainCheckpointCandidate = Readonly<{
  statement: string;
  sourceMessageIds: readonly string[];
}>;

/** Alarm時点で期限を迎えたcheckpointをQueue投入対象として返す。 */
export async function listDueDiaryBrainCheckpointIds(
  db: D1Client,
  accountId: string,
  at = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ id: diaryBrainCheckpoints.id })
    .from(diaryBrainCheckpoints)
    .where(
      and(
        eq(diaryBrainCheckpoints.accountId, accountId),
        eq(diaryBrainCheckpoints.status, "pending"),
        lte(diaryBrainCheckpoints.nextAttemptAt, at),
        eq(diaryBrainCheckpoints.isDeleted, false),
      ),
    )
    .orderBy(diaryBrainCheckpoints.nextAttemptAt)
    .limit(10)
    .all();
  return rows.map(({ id }) => id);
}

/** Queueの重複投入を抑えつつ、未完了jobを30秒後に再投入可能にする。 */
export async function deferDiaryBrainCheckpoint(
  db: D1Client,
  accountId: string,
  checkpointId: string,
  at = new Date(),
): Promise<void> {
  await db
    .update(diaryBrainCheckpoints)
    .set({
      nextAttemptAt: new Date(at.getTime() + 30_000),
      attemptCount: sql`${diaryBrainCheckpoints.attemptCount} + 1`,
      updatedAt: at,
    })
    .where(
      and(
        eq(diaryBrainCheckpoints.id, checkpointId),
        eq(diaryBrainCheckpoints.accountId, accountId),
        eq(diaryBrainCheckpoints.status, "pending"),
      ),
    );
}

/** AI変換用に、checkpoint範囲の会話だけをAccount所有権付きで返す。 */
export async function getDiaryBrainCheckpointContext(
  db: D1Client,
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
        eq(diaryBrainCheckpoints.accountId, accountId),
        eq(diaryBrainCheckpoints.status, "pending"),
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
        gte(conversationMessages.sequence, checkpoint.fromSequence),
        lte(conversationMessages.sequence, checkpoint.throughSequence),
        eq(conversationMessages.isDeleted, false),
        or(isNull(sourceRecords.id), eq(sourceRecords.accountId, accountId)),
      ),
    )
    .orderBy(conversationMessages.sequence)
    .all();
  const messages = rows.flatMap((row) => {
    const body = row.role === "user" ? row.userBody : row.assistantBody;
    return body ? [{ id: row.id, role: row.role, body, sequence: row.sequence }] : [];
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
  db: D1Client,
  accountId: string,
  checkpointId: string,
  expectedThroughSequence: number,
  promptVersion: string,
  candidates: readonly DiaryBrainCheckpointCandidate[],
  at = new Date(),
): Promise<boolean> {
  const context = await getDiaryBrainCheckpointContext(db, accountId, checkpointId);
  if (!context || context.throughSequence !== expectedThroughSequence) return false;
  const checkpoint = await db
    .select()
    .from(diaryBrainCheckpoints)
    .where(eq(diaryBrainCheckpoints.id, checkpointId))
    .get();
  if (!checkpoint) return false;
  const statements: BatchItem<"sqlite">[] = [];
  for (const candidate of candidates.slice(0, 3)) {
    const messageIds = [...new Set(candidate.sourceMessageIds)];
    if (
      !candidate.statement.trim() ||
      messageIds.length === 0 ||
      messageIds.length !== candidate.sourceMessageIds.length
    ) {
      continue;
    }
    const sources = await db
      .select({ id: sourceRecords.id, createdAt: sourceRecords.createdAt })
      .from(conversationMessages)
      .innerJoin(sourceRecords, eq(conversationMessages.sourceRecordId, sourceRecords.id))
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
    if (sources.length !== messageIds.length) continue;
    const brainItemId = crypto.randomUUID();
    const lifecycle = { createdAt: at, updatedAt: at };
    statements.push(
      db.insert(brainItems).values({
        id: brainItemId,
        accountId,
        category: "memory",
        statement: candidate.statement.trim(),
        attributes: {
          sourceKind: "diary",
          sessionId: checkpoint.sessionId,
          checkpointId,
          promptVersion,
          isInference: false,
        },
        derivation: "ai",
        status: "active",
        validFrom: new Date(Math.min(...sources.map(({ createdAt }) => createdAt.getTime()))),
        stability: "stable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
        ...lifecycle,
      }),
      ...sources.map((source) =>
        db.insert(brainItemEvidenceEdges).values({
          id: crypto.randomUUID(),
          accountId,
          brainItemId,
          sourceRecordId: source.id,
          relation: "supports",
          isDerivationTrigger: true,
          derivationMethod: "ai",
          generatedAt: at,
          ...lifecycle,
        }),
      ),
      db.insert(brainItemAccessLabels).values({
        id: crypto.randomUUID(),
        accountId,
        brainItemId,
        label: "unclassified",
        assignedBy: "system",
        ...lifecycle,
      }),
      db.insert(brainItemTopicLabels).values({
        id: crypto.randomUUID(),
        accountId,
        brainItemId,
        label: "diary",
        ...lifecycle,
      }),
    );
  }
  statements.push(
    db
      .update(diaryBrainCheckpoints)
      .set({ status: "applied", appliedAt: at, updatedAt: at })
      .where(
        and(
          eq(diaryBrainCheckpoints.id, checkpointId),
          eq(diaryBrainCheckpoints.accountId, accountId),
          eq(diaryBrainCheckpoints.status, "pending"),
          eq(diaryBrainCheckpoints.throughSequence, expectedThroughSequence),
        ),
      ),
  );
  const [first, ...rest] = statements;
  if (!first) return false;
  await db.batch([first, ...rest]);
  return true;
}

export async function markTurnGenerating(db: D1Client, turnId: string): Promise<boolean> {
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
  db: D1Client,
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
export async function isTurnSessionActive(db: D1Client, turnId: string): Promise<boolean> {
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
  db: D1Client,
  input: {
    turnId: string;
    body: string;
    endSession: boolean;
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

  const session = await db
    .select()
    .from(conversationSessions)
    .where(eq(conversationSessions.id, turn.sessionId))
    .get();
  if (!session) throw new Error("Conversation session was not found");
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
        finalReplyRequestedAt: now,
        updatedAt: now,
      })
      .where(eq(chatTurns.id, input.turnId)),
  ];
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
  db: D1Client,
  accountId: string,
  turnId: string,
): Promise<{ body: string; endSession: boolean } | undefined> {
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
  return row?.body
    ? {
        body: row.body,
        endSession: row.endSession,
      }
    : undefined;
}

export async function closeTurnSession(db: D1Client, turnId: string): Promise<void> {
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

export async function closeExpiredSessions(db: D1Client, now = new Date()): Promise<number> {
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

export async function markTurnDelivered(db: D1Client, turnId: string): Promise<boolean> {
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
  db: D1Client,
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
