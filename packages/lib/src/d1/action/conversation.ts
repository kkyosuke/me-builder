import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { D1Client } from "../client";
import {
  chatTurns,
  conversationMessages,
  conversationSessions,
  sourceRecordTextPayloads,
  sourceRecords,
} from "../schema";

const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;

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

function changedRowCount(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  if ("meta" in result && typeof result.meta === "object" && result.meta !== null) {
    const changes = "changes" in result.meta ? result.meta.changes : undefined;
    if (typeof changes === "number") return changes;
  }
  const changes = "changes" in result ? result.changes : undefined;
  return typeof changes === "number" ? changes : 0;
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
  promptVersion: string,
): Promise<AttachedTurn> {
  if (inputs.length === 0) {
    throw new Error("Cannot create a chat turn without messages");
  }
  if (!promptVersion.trim()) {
    throw new Error("A chat turn must record its prompt version");
  }
  const accountId = inputs[0]?.accountId;
  if (!accountId || inputs.some((input) => input.accountId !== accountId)) {
    throw new Error("A chat turn must contain messages from one account");
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
    );

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
      .where(inArray(conversationSessions.id, sessionIds));
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
      inputs.filter(({ eventId }) => !attachedEventIds.has(eventId)),
      generationEpoch,
      model,
      promptVersion,
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
    session = {
      id: crypto.randomUUID(),
      accountId,
      status: "active" as const,
      startedAt: firstReceivedAt,
      lastUserMessageAt: lastReceivedAt,
      lastAssistantMessageAt: null,
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
      promptVersion,
      model,
      receivedAt: firstReceivedAt,
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
      messages: ConversationContextMessage[];
      currentUserMessageIds: string[];
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
    .limit(Math.max(messageLimit, turn.throughSequence - turn.fromSequence + 1));

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
    .where(and(eq(chatTurns.id, turnId), inArray(chatTurns.status, ["queued", "generating"])));
  return changedRowCount(result) > 0;
}

export async function getTurnStatus(
  db: D1Client,
  turnId: string,
): Promise<(typeof chatTurns.$inferSelect)["status"] | undefined> {
  return db
    .select({ status: chatTurns.status })
    .from(chatTurns)
    .where(eq(chatTurns.id, turnId))
    .get()
    .then((row) => row?.status);
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
  await db.batch([
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
  ]);
  return messageId;
}

export async function getPendingAssistantResponse(
  db: D1Client,
  input: { accountId: string; turnId: string },
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
        eq(chatTurns.id, input.turnId),
        eq(chatTurns.status, "delivery_pending"),
        eq(conversationSessions.accountId, input.accountId),
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
    );
}

export async function closeExpiredSessions(db: D1Client, now = new Date()): Promise<number> {
  const inactiveCutoff = new Date(now.getTime() - SESSION_INACTIVITY_MS);
  const hardCapCutoff = new Date(now.getTime() - SESSION_HARD_CAP_MS);
  const hardCapResult = await db
    .update(conversationSessions)
    .set({ status: "closed", closeReason: "hard_cap", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationSessions.status, "active"),
        lte(conversationSessions.startedAt, hardCapCutoff),
      ),
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
  return changedRowCount(hardCapResult) + changedRowCount(inactiveResult);
}

export async function markTurnDelivered(db: D1Client, turnId: string): Promise<boolean> {
  const result = await db
    .update(chatTurns)
    .set({ status: "delivered", updatedAt: new Date() })
    .where(and(eq(chatTurns.id, turnId), eq(chatTurns.status, "delivery_pending")));
  if (changedRowCount(result) > 0) return true;
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
  const result = await db
    .update(chatTurns)
    .set({ status: "failed", failureStage, updatedAt: new Date() })
    .where(
      and(eq(chatTurns.id, turnId), inArray(chatTurns.status, ["generating", "delivery_pending"])),
    );
  if (changedRowCount(result) > 0) return true;
  return Boolean(
    await db
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .where(and(eq(chatTurns.id, turnId), eq(chatTurns.status, "failed")))
      .get(),
  );
}
