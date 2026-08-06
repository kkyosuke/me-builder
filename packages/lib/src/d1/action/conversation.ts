import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { D1Client } from "../client";
import {
  chatTurns,
  conversationMessages,
  conversationSessions,
  sessionSummaries,
  sourceRecordTextPayloads,
  sourceRecords,
} from "../schema";

const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;
export const DIARY_CHAT_PROMPT_VERSION = "diary-chat-v1";

export type StoredLineSource = {
  sourceRecordId: string;
  accountId: string;
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
    accountId: input.accountId,
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
  inputs: AttachMessageInput[],
  generationEpoch: number,
  model: string,
): Promise<AttachedTurn> {
  if (inputs.length === 0) {
    throw new Error("Cannot create a chat turn without messages");
  }
  const accountId = inputs[0]?.accountId;
  if (!accountId || inputs.some((input) => input.accountId !== accountId)) {
    throw new Error("A chat turn must contain messages from one account");
  }

  const eventIds = inputs.map((input) => input.eventId);
  const existingMessages = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.channel, "line"),
        inArray(conversationMessages.channelEventId, eventIds),
      ),
    );

  if (existingMessages.length === inputs.length) {
    const ordered = [...existingMessages].sort((a, b) => a.sequence - b.sequence);
    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first || !last) throw new Error("Existing conversation messages are incomplete");
    const existingTurn = await db
      .select()
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.sessionId, first.sessionId),
          eq(chatTurns.fromSequence, first.sequence),
          eq(chatTurns.throughSequence, last.sequence),
        ),
      )
      .get();
    if (!existingTurn) throw new Error("Conversation messages exist without their chat turn");
    return {
      turnId: existingTurn.id,
      sessionId: existingTurn.sessionId,
      generationEpoch: existingTurn.generationEpoch,
    };
  }
  if (existingMessages.length > 0) {
    throw new Error("Partially attached chat turn requires operator reconciliation");
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

  const sessionExpired =
    session &&
    (lastReceivedAt.getTime() - session.lastUserMessageAt.getTime() >= SESSION_INACTIVITY_MS ||
      lastReceivedAt >= session.hardCloseAt);
  const writes: BatchItem<"sqlite">[] = [];
  if (sessionExpired && session) {
    writes.push(
      db
        .update(conversationSessions)
        .set({
          status: "closed",
          closedAt: lastReceivedAt,
          closeReason: lastReceivedAt >= session.hardCloseAt ? "hard_cap" : "inactive",
          updatedAt: lastReceivedAt,
        })
        .where(eq(conversationSessions.id, session.id)),
    );
    session = undefined;
  }

  if (!session) {
    session = {
      id: crypto.randomUUID(),
      accountId,
      status: "active" as const,
      startedAt: firstReceivedAt,
      lastUserMessageAt: lastReceivedAt,
      lastAssistantMessageAt: null,
      hardCloseAt: new Date(firstReceivedAt.getTime() + SESSION_HARD_CAP_MS),
      closedAt: null,
      closeReason: null,
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
    kind: "message" as const,
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

  writes.push(
    db.insert(conversationMessages).values(userMessages),
    db
      .update(conversationSessions)
      .set({ nextSequence: throughSequence + 1, lastUserMessageAt: lastReceivedAt, updatedAt: now })
      .where(eq(conversationSessions.id, session.id)),
    db.insert(chatTurns).values({
      id: turnId,
      sessionId: session.id,
      fromSequence,
      throughSequence,
      generationEpoch,
      status: "queued",
      promptVersion: DIARY_CHAT_PROMPT_VERSION,
      model,
      receivedAt: firstReceivedAt,
      firstReplyRequestedAt: now,
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

export type ConversationSessionSummary = {
  summaryJson: string;
  coveredThroughSequence: number;
};

/** 直近20件より前の本文を、根拠ID付きの決定的なSession Summaryへ圧縮する。 */
export async function refreshTurnSummary(db: D1Client, turnId: string): Promise<void> {
  const turn = await db
    .select({
      sessionId: chatTurns.sessionId,
      fromSequence: chatTurns.fromSequence,
      throughSequence: chatTurns.throughSequence,
    })
    .from(chatTurns)
    .where(eq(chatTurns.id, turnId))
    .get();
  if (!turn) return;
  const coveredThroughSequence = Math.min(turn.throughSequence - 20, turn.fromSequence - 1);
  if (coveredThroughSequence < 1) return;
  const existing = await db
    .select({
      coveredThroughSequence: sessionSummaries.coveredThroughSequence,
      summaryJson: sessionSummaries.summaryJson,
    })
    .from(sessionSummaries)
    .where(eq(sessionSummaries.sessionId, turn.sessionId))
    .get();
  if ((existing?.coveredThroughSequence ?? 0) >= coveredThroughSequence) return;

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
        gt(conversationMessages.sequence, existing?.coveredThroughSequence ?? 0),
        lte(conversationMessages.sequence, coveredThroughSequence),
        eq(conversationMessages.isDeleted, false),
      ),
    )
    .orderBy(asc(conversationMessages.sequence));
  let previousClaims: Array<{
    speaker: "user" | "assistant";
    text: string;
    source_message_ids: string[];
  }> = [];
  if (existing) {
    try {
      const parsed = JSON.parse(existing.summaryJson) as { claims?: typeof previousClaims };
      previousClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
    } catch {
      previousClaims = [];
    }
  }
  const newClaims = rows.flatMap((row) => {
    const body = row.role === "user" ? row.userBody : row.assistantBody;
    return body
      ? [{ speaker: row.role, text: body.slice(0, 300), source_message_ids: [row.id] }]
      : [];
  });
  const claims = [...previousClaims, ...newClaims];
  const now = new Date();
  await db
    .insert(sessionSummaries)
    .values({
      sessionId: turn.sessionId,
      summaryJson: JSON.stringify({ claims }),
      coveredThroughSequence,
      sourceMessageIdsJson: JSON.stringify(claims.flatMap((claim) => claim.source_message_ids)),
      promptVersion: DIARY_CHAT_PROMPT_VERSION,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionSummaries.sessionId,
      set: {
        summaryJson: JSON.stringify({ claims }),
        coveredThroughSequence,
        sourceMessageIdsJson: JSON.stringify(claims.flatMap((claim) => claim.source_message_ids)),
        promptVersion: DIARY_CHAT_PROMPT_VERSION,
        revision: sql`${sessionSummaries.revision} + 1`,
        updatedAt: now,
      },
    });
}

/** Turnと同じSessionの直近messageを、Account所有権を含むjoinで取得する。 */
export async function getTurnContext(
  db: D1Client,
  turnId: string,
): Promise<
  | {
      accountId: string;
      messages: ConversationContextMessage[];
      currentUserMessageIds: string[];
      summary?: ConversationSessionSummary;
    }
  | undefined
> {
  const turn = await db
    .select({
      sessionId: chatTurns.sessionId,
      accountId: conversationSessions.accountId,
      fromSequence: chatTurns.fromSequence,
      throughSequence: chatTurns.throughSequence,
    })
    .from(chatTurns)
    .innerJoin(conversationSessions, eq(chatTurns.sessionId, conversationSessions.id))
    .where(eq(chatTurns.id, turnId))
    .get();
  if (!turn) return undefined;

  await refreshTurnSummary(db, turnId);
  const summary = await db
    .select({
      summaryJson: sessionSummaries.summaryJson,
      coveredThroughSequence: sessionSummaries.coveredThroughSequence,
    })
    .from(sessionSummaries)
    .where(eq(sessionSummaries.sessionId, turn.sessionId))
    .get();

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
    .limit(Math.max(20, turn.throughSequence - turn.fromSequence + 1));

  const messages = rows.reverse().flatMap((row) => {
    const body = row.role === "user" ? row.userBody : row.assistantBody;
    return body ? [{ id: row.id, role: row.role, body, sequence: row.sequence }] : [];
  });
  return {
    accountId: turn.accountId,
    messages,
    currentUserMessageIds: messages
      .filter(
        ({ role, sequence }) =>
          role === "user" && sequence >= turn.fromSequence && sequence <= turn.throughSequence,
      )
      .map(({ id }) => id),
    ...(summary ? { summary } : {}),
  };
}

export async function markTurnGenerating(db: D1Client, turnId: string): Promise<boolean> {
  const result = await db
    .update(chatTurns)
    .set({
      status: "generating",
      generationStartedAt: new Date(),
      attemptCount: sql`${chatTurns.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatTurns.id, turnId),
        inArray(chatTurns.status, ["queued", "generating", "delivery_pending"]),
      ),
    );
  return (result.meta.changes ?? 0) > 0;
}

export async function saveAssistantResponse(
  db: D1Client,
  input: {
    turnId: string;
    body: string;
    kind: "message" | "safety" | "error";
    safetyRoute: string;
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
  await db.batch([
    db.insert(conversationMessages).values({
      id: messageId,
      sessionId: session.id,
      sequence: session.nextSequence,
      role: "assistant",
      kind: input.kind,
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
        safetyRoute: input.safetyRoute,
        endSession: input.endSession,
        finalReplyRequestedAt: now,
        updatedAt: now,
      })
      .where(eq(chatTurns.id, input.turnId)),
  ]);
  return messageId;
}

export async function getPendingAssistantResponse(
  db: D1Client,
  turnId: string,
): Promise<{ body: string; safetyRoute: string; endSession: boolean } | undefined> {
  const row = await db
    .select({
      body: conversationMessages.assistantBody,
      safetyRoute: chatTurns.safetyRoute,
      endSession: chatTurns.endSession,
    })
    .from(chatTurns)
    .innerJoin(conversationMessages, eq(chatTurns.responseMessageId, conversationMessages.id))
    .where(eq(chatTurns.id, turnId))
    .get();
  return row?.body
    ? {
        body: row.body,
        safetyRoute: row.safetyRoute ?? "normal",
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
    );
}

export async function closeExpiredSessions(db: D1Client, now = new Date()): Promise<number> {
  const inactiveCutoff = new Date(now.getTime() - SESSION_INACTIVITY_MS);
  const hardCapResult = await db
    .update(conversationSessions)
    .set({ status: "closed", closeReason: "hard_cap", closedAt: now, updatedAt: now })
    .where(
      and(eq(conversationSessions.status, "active"), lte(conversationSessions.hardCloseAt, now)),
    );
  const inactiveResult = await db
    .update(conversationSessions)
    .set({ status: "closed", closeReason: "inactive", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationSessions.status, "active"),
        lte(conversationSessions.lastUserMessageAt, inactiveCutoff),
      ),
    );
  return (hardCapResult.meta.changes ?? 0) + (inactiveResult.meta.changes ?? 0);
}

export async function markTurnDelivered(db: D1Client, turnId: string): Promise<void> {
  await db
    .update(chatTurns)
    .set({ status: "delivered", updatedAt: new Date() })
    .where(eq(chatTurns.id, turnId));
}

export async function markTurnFailed(
  db: D1Client,
  turnId: string,
  failureStage: string,
): Promise<void> {
  await db
    .update(chatTurns)
    .set({ status: "failed", failureStage, updatedAt: new Date() })
    .where(eq(chatTurns.id, turnId));
}

/** Session終了24時間後のassistant本文を小分けに削除する。 */
export async function purgeExpiredConversationBodies(
  db: D1Client,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const expiredSessions = await db
    .select({ id: conversationSessions.id })
    .from(conversationSessions)
    .where(
      and(eq(conversationSessions.status, "closed"), lte(conversationSessions.closedAt, cutoff)),
    );
  if (expiredSessions.length > 0) {
    await db.delete(sessionSummaries).where(
      inArray(
        sessionSummaries.sessionId,
        expiredSessions.map(({ id }) => id),
      ),
    );
  }
  const expired = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .innerJoin(conversationSessions, eq(conversationMessages.sessionId, conversationSessions.id))
    .where(
      and(
        eq(conversationSessions.status, "closed"),
        lte(conversationSessions.closedAt, cutoff),
        eq(conversationMessages.role, "assistant"),
        isNotNull(conversationMessages.assistantBody),
      ),
    )
    .orderBy(asc(conversationMessages.createdAt))
    .limit(100);
  if (expired.length === 0) return 0;
  await db
    .update(conversationMessages)
    .set({ assistantBody: null, updatedAt: now })
    .where(
      inArray(
        conversationMessages.id,
        expired.map(({ id }) => id),
      ),
    );
  return expired.length;
}
