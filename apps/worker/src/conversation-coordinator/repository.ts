import { and, asc, count, eq, inArray, lte, min, notInArray, sql } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import type { AcceptedDiaryMessage } from ".";
import { acceptedMessages, coordinatorSchema, coordinatorState, localTurns } from "./schema";

type CoordinatorDatabase = DrizzleSqliteDODatabase<typeof coordinatorSchema>;

export class ConversationCoordinatorRepository {
  private readonly db: CoordinatorDatabase;

  constructor(storage: DurableObjectStorage) {
    this.db = drizzle(storage, { schema: coordinatorSchema });
  }

  initialize(): void {
    this.db.run(
      sql.raw(`
      CREATE TABLE IF NOT EXISTS accepted_messages (
        event_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS accepted_message_status_received_idx
        ON accepted_messages(status, received_at);
      CREATE TABLE IF NOT EXISTS coordinator_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation_epoch INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS local_turns (
        turn_id TEXT PRIMARY KEY,
        generation_epoch INTEGER NOT NULL,
        status TEXT NOT NULL,
        lease_token TEXT,
        hard_deadline_at INTEGER
      );
    `),
    );
    this.db
      .insert(coordinatorState)
      .values({ singleton: 1, generationEpoch: 0 })
      .onConflictDoNothing()
      .run();
  }

  hasAcceptedMessage(eventId: string): boolean {
    return Boolean(
      this.db
        .select({ eventId: acceptedMessages.eventId })
        .from(acceptedMessages)
        .where(eq(acceptedMessages.eventId, eventId))
        .get(),
    );
  }

  addAcceptedMessage(input: AcceptedDiaryMessage): void {
    this.db
      .insert(acceptedMessages)
      .values({
        eventId: input.eventId,
        accountId: input.accountId,
        sourceRecordId: input.sourceRecordId,
        receivedAt: new Date(input.receivedAt).getTime(),
      })
      .run();
  }

  findTurn(turnId: string) {
    return this.db.select().from(localTurns).where(eq(localTurns.turnId, turnId)).get();
  }

  findEarliestOpenTurnId(): string | undefined {
    return this.db
      .select({ turnId: localTurns.turnId })
      .from(localTurns)
      .where(notInArray(localTurns.status, ["delivered", "failed"]))
      .orderBy(asc(localTurns.generationEpoch))
      .limit(1)
      .get()?.turnId;
  }

  startGeneration(turnId: string, leaseToken: string, hardDeadlineAt: number): void {
    this.db
      .update(localTurns)
      .set({ status: "generating", leaseToken, hardDeadlineAt })
      .where(eq(localTurns.turnId, turnId))
      .run();
  }

  isLeaseActive(turnId: string, generationEpoch: number, leaseToken: string, now: number): boolean {
    const current = this.db
      .select({ hardDeadlineAt: localTurns.hardDeadlineAt })
      .from(localTurns)
      .where(
        and(
          eq(localTurns.turnId, turnId),
          eq(localTurns.generationEpoch, generationEpoch),
          eq(localTurns.leaseToken, leaseToken),
          eq(localTurns.status, "generating"),
        ),
      )
      .get();
    return Boolean(current && (current.hardDeadlineAt ?? 0) >= now);
  }

  completeGeneration(turnId: string): void {
    this.db
      .update(localTurns)
      .set({ status: "delivered", leaseToken: null })
      .where(eq(localTurns.turnId, turnId))
      .run();
  }

  failGeneration(turnId: string, generationEpoch: number, leaseToken: string): void {
    this.db
      .update(localTurns)
      .set({ status: "failed", leaseToken: null })
      .where(
        and(
          eq(localTurns.turnId, turnId),
          eq(localTurns.generationEpoch, generationEpoch),
          eq(localTurns.leaseToken, leaseToken),
        ),
      )
      .run();
  }

  releaseGeneration(turnId: string, generationEpoch: number, leaseToken: string): void {
    this.db
      .update(localTurns)
      .set({ status: "queued", leaseToken: null, hardDeadlineAt: null })
      .where(
        and(
          eq(localTurns.turnId, turnId),
          eq(localTurns.generationEpoch, generationEpoch),
          eq(localTurns.leaseToken, leaseToken),
          eq(localTurns.status, "generating"),
        ),
      )
      .run();
  }

  expireGenerationLeases(now: number): void {
    this.db
      .update(localTurns)
      .set({ status: "pending_queue", leaseToken: null, hardDeadlineAt: null })
      .where(and(eq(localTurns.status, "generating"), lte(localTurns.hardDeadlineAt, now)))
      .run();
  }

  listPendingQueueTurns() {
    return this.db
      .select({ turnId: localTurns.turnId, generationEpoch: localTurns.generationEpoch })
      .from(localTurns)
      .where(eq(localTurns.status, "pending_queue"))
      .orderBy(asc(localTurns.generationEpoch))
      .all();
  }

  listPendingMessages() {
    return this.db
      .select()
      .from(acceptedMessages)
      .where(inArray(acceptedMessages.status, ["pending", "attaching"]))
      .orderBy(asc(acceptedMessages.receivedAt), asc(acceptedMessages.eventId))
      .all();
  }

  nextGenerationEpoch(): number {
    return this.db.transaction((tx) => {
      const current = tx
        .select({ generationEpoch: coordinatorState.generationEpoch })
        .from(coordinatorState)
        .where(eq(coordinatorState.singleton, 1))
        .get()?.generationEpoch;
      if (current === undefined) throw new Error("Coordinator state is not initialized");
      const next = current + 1;
      tx.update(coordinatorState)
        .set({ generationEpoch: next })
        .where(eq(coordinatorState.singleton, 1))
        .run();
      return next;
    });
  }

  markMessagesAttaching(eventIds: string[]): void {
    this.db
      .update(acceptedMessages)
      .set({ status: "attaching" })
      .where(inArray(acceptedMessages.eventId, eventIds))
      .run();
  }

  markMessagesAttached(eventIds: string[]): void {
    this.db
      .update(acceptedMessages)
      .set({ status: "attached" })
      .where(inArray(acceptedMessages.eventId, eventIds))
      .run();
  }

  addPendingTurn(turnId: string, generationEpoch: number): void {
    this.db
      .insert(localTurns)
      .values({ turnId, generationEpoch, status: "pending_queue" })
      .onConflictDoNothing()
      .run();
  }

  markTurnQueued(turnId: string): void {
    this.db
      .update(localTurns)
      .set({ status: "queued" })
      .where(and(eq(localTurns.turnId, turnId), eq(localTurns.status, "pending_queue")))
      .run();
  }

  hasPendingWork(): boolean {
    const acceptedCount = this.db
      .select({ value: count() })
      .from(acceptedMessages)
      .where(eq(acceptedMessages.status, "pending"))
      .get()?.value;
    const turnCount = this.db
      .select({ value: count() })
      .from(localTurns)
      .where(eq(localTurns.status, "pending_queue"))
      .get()?.value;
    return (acceptedCount ?? 0) > 0 || (turnCount ?? 0) > 0;
  }

  earliestLeaseDeadline(): number | null {
    return (
      this.db
        .select({ value: min(localTurns.hardDeadlineAt) })
        .from(localTurns)
        .where(eq(localTurns.status, "generating"))
        .get()?.value ?? null
    );
  }
}
