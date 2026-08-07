import { and, asc, count, eq, inArray, lte, min, notInArray } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import type { AcceptedDiaryMessage } from ".";
import migrations from "../../drizzle/migrations.js";
import {
  acceptedMessages,
  attachBatchMessages,
  attachBatches,
  coordinatorIdentity,
  coordinatorSchema,
  coordinatorState,
  deliveryOutbox,
  localTurns,
} from "./schema";

export type DeliveryOutboxRow = typeof deliveryOutbox.$inferSelect;

type CoordinatorDatabase = DrizzleSqliteDODatabase<typeof coordinatorSchema>;

export class ConversationCoordinatorRepository {
  private readonly db: CoordinatorDatabase;

  constructor(storage: DurableObjectStorage) {
    this.db = drizzle(storage, { schema: coordinatorSchema });
  }

  async initialize(): Promise<void> {
    await migrate(this.db, migrations);
    this.db
      .insert(coordinatorState)
      .values({ singleton: 1, generationEpoch: 0 })
      .onConflictDoNothing()
      .run();
    this.recoverUnbatchedAttachingMessages();
  }

  bindAccount(accountId: string): boolean {
    const existing = this.db
      .select({ accountId: coordinatorIdentity.accountId })
      .from(coordinatorIdentity)
      .where(eq(coordinatorIdentity.singleton, 1))
      .get();
    if (existing) return existing.accountId === accountId;
    const legacyAccountId = this.db
      .select({ accountId: acceptedMessages.accountId })
      .from(acceptedMessages)
      .limit(1)
      .get()?.accountId;
    const boundAccountId = legacyAccountId ?? accountId;
    this.db.insert(coordinatorIdentity).values({ singleton: 1, accountId: boundAccountId }).run();
    return boundAccountId === accountId;
  }

  getBoundAccountId(): string | undefined {
    return this.db
      .select({ accountId: coordinatorIdentity.accountId })
      .from(coordinatorIdentity)
      .where(eq(coordinatorIdentity.singleton, 1))
      .get()?.accountId;
  }

  findAcceptedMessage(eventId: string) {
    return this.db
      .select()
      .from(acceptedMessages)
      .where(eq(acceptedMessages.eventId, eventId))
      .get();
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

  findTurnDelivery(turnId: string, generationEpoch: number, kind: "final" | "failure") {
    return this.db
      .select()
      .from(deliveryOutbox)
      .where(
        and(
          eq(deliveryOutbox.turnId, turnId),
          eq(deliveryOutbox.generationEpoch, generationEpoch),
          eq(deliveryOutbox.kind, kind),
        ),
      )
      .get();
  }

  createDelivery(outbox: typeof deliveryOutbox.$inferInsert): DeliveryOutboxRow {
    this.db.insert(deliveryOutbox).values(outbox).onConflictDoNothing().run();
    const persisted = this.db
      .select()
      .from(deliveryOutbox)
      .where(eq(deliveryOutbox.id, outbox.id))
      .get();
    if (!persisted) throw new Error("Delivery outbox could not be persisted");
    return persisted;
  }

  listPendingDeliveries() {
    return this.db
      .select()
      .from(deliveryOutbox)
      .where(eq(deliveryOutbox.status, "pending"))
      .orderBy(asc(deliveryOutbox.createdAt))
      .all();
  }

  markDeliveryStatus(
    id: string,
    status: "delivered" | "permanent_failure" | "delivery_unknown",
  ): void {
    this.db.update(deliveryOutbox).set({ status }).where(eq(deliveryOutbox.id, id)).run();
  }

  expirePendingDeliveries(now: number): void {
    this.db
      .update(deliveryOutbox)
      .set({ status: "delivery_unknown" })
      .where(and(eq(deliveryOutbox.status, "pending"), lte(deliveryOutbox.deadlineAt, now)))
      .run();
  }

  earliestDeliveryDeadline(): number | null {
    return (
      this.db
        .select({ value: min(deliveryOutbox.deadlineAt) })
        .from(deliveryOutbox)
        .where(eq(deliveryOutbox.status, "pending"))
        .get()?.value ?? null
    );
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

  /** 生成待ちのままQueueのretryを使い切ったTurnを、alarmから再投入できる状態へ戻す。 */
  requeueTurn(turnId: string, generationEpoch: number): void {
    this.db
      .update(localTurns)
      .set({ status: "pending_queue", leaseToken: null, hardDeadlineAt: null })
      .where(
        and(
          eq(localTurns.turnId, turnId),
          eq(localTurns.generationEpoch, generationEpoch),
          notInArray(localTurns.status, ["delivered", "failed", "generating"]),
        ),
      )
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
      .where(eq(acceptedMessages.status, "pending"))
      .orderBy(asc(acceptedMessages.receivedAt), asc(acceptedMessages.eventId))
      .all();
  }

  findAttachBatch() {
    const batch = this.db
      .select()
      .from(attachBatches)
      .orderBy(asc(attachBatches.generationEpoch))
      .limit(1)
      .get();
    if (!batch) return undefined;
    const messages = this.db
      .select({ message: acceptedMessages })
      .from(attachBatchMessages)
      .innerJoin(acceptedMessages, eq(attachBatchMessages.eventId, acceptedMessages.eventId))
      .where(eq(attachBatchMessages.batchId, batch.id))
      .orderBy(asc(acceptedMessages.receivedAt), asc(acceptedMessages.eventId))
      .all()
      .map(({ message }) => message);
    if (messages.length === 0) throw new Error("Attach batch exists without messages");
    return { ...batch, messages };
  }

  createAttachBatch(eventIds: string[], generationEpoch: number): string {
    if (eventIds.length === 0) throw new Error("Cannot create an empty attach batch");
    const batchId = crypto.randomUUID();
    this.db.transaction((tx) => {
      tx.insert(attachBatches).values({ id: batchId, generationEpoch }).run();
      tx.insert(attachBatchMessages)
        .values(eventIds.map((eventId) => ({ eventId, batchId })))
        .run();
      tx.update(acceptedMessages)
        .set({ status: "attaching" })
        .where(
          and(inArray(acceptedMessages.eventId, eventIds), eq(acceptedMessages.status, "pending")),
        )
        .run();
    });
    return batchId;
  }

  completeAttachBatch(
    batchId: string,
    eventIds: string[],
    turn?: { turnId: string; generationEpoch: number },
  ): void {
    this.db.transaction((tx) => {
      if (turn) {
        tx.insert(localTurns)
          .values({ ...turn, status: "pending_queue" })
          .onConflictDoNothing()
          .run();
      }
      tx.update(acceptedMessages)
        .set({ status: "attached" })
        .where(inArray(acceptedMessages.eventId, eventIds))
        .run();
      tx.delete(attachBatchMessages).where(eq(attachBatchMessages.batchId, batchId)).run();
      tx.delete(attachBatches).where(eq(attachBatches.id, batchId)).run();
    });
  }

  nextGenerationEpoch(): number {
    let nextGenerationEpoch: number | undefined;
    this.db.transaction((tx) => {
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
      nextGenerationEpoch = next;
    });
    if (nextGenerationEpoch === undefined) {
      throw new Error("Coordinator generation epoch was not updated");
    }
    return nextGenerationEpoch;
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
    const batchCount = this.db.select({ value: count() }).from(attachBatches).get()?.value;
    return (acceptedCount ?? 0) > 0 || (turnCount ?? 0) > 0 || (batchCount ?? 0) > 0;
  }

  cleanupTerminalState(attachedBefore: number): void {
    const expiredOutboxIds = this.db
      .select({ id: deliveryOutbox.id })
      .from(deliveryOutbox)
      .where(
        and(
          inArray(deliveryOutbox.status, ["delivered", "permanent_failure", "delivery_unknown"]),
          lte(deliveryOutbox.createdAt, attachedBefore),
        ),
      )
      .all()
      .map(({ id }) => id);
    this.db.transaction((tx) => {
      tx.delete(localTurns)
        .where(inArray(localTurns.status, ["delivered", "failed"]))
        .run();
      tx.delete(acceptedMessages)
        .where(
          and(
            eq(acceptedMessages.status, "attached"),
            lte(acceptedMessages.receivedAt, attachedBefore),
          ),
        )
        .run();
      if (expiredOutboxIds.length > 0) {
        tx.delete(deliveryOutbox).where(inArray(deliveryOutbox.id, expiredOutboxIds)).run();
      }
    });
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

  private recoverUnbatchedAttachingMessages(): void {
    if (this.db.select({ value: count() }).from(attachBatches).get()?.value) return;
    const messages = this.db
      .select({ eventId: acceptedMessages.eventId })
      .from(acceptedMessages)
      .where(eq(acceptedMessages.status, "attaching"))
      .orderBy(asc(acceptedMessages.receivedAt), asc(acceptedMessages.eventId))
      .all();
    if (messages.length === 0) return;
    const generationEpoch = this.db
      .select({ generationEpoch: coordinatorState.generationEpoch })
      .from(coordinatorState)
      .where(eq(coordinatorState.singleton, 1))
      .get()?.generationEpoch;
    if (generationEpoch === undefined) throw new Error("Coordinator state is not initialized");
    this.createAttachBatch(
      messages.map(({ eventId }) => eventId),
      generationEpoch,
    );
  }
}
