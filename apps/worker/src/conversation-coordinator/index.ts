import { DurableObject } from "cloudflare:workers";
import { d1 } from "@me-builder/lib";
import {
  type ChatTurnQueueMessage,
  type GenerationLease,
  type ReceiptReservation,
  type TurnDeliveryRequest,
  type TurnDeliveryResult,
  logger,
} from "@me-builder/shared";
import { DEFAULT_GEMINI_MODEL, getCloudflareBindings } from "../config";
import type { CloudflareBindings } from "../config";
import {
  createLineRetryKey,
  getLineDeliveryFailureKind,
  pushLineTextWithRetryKey,
} from "../infrastructure/line-delivery";
import type { Env } from "../types";
import { ConversationCoordinatorRepository } from "./repository";

const COALESCE_MS = 1_500;
const LEASE_MS = 90_000;
const ALARM_RETRY_MS = 30_000;
const ACCEPTED_MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECEIPT_DEADLINE_MS = 30_000;
const DELIVERY_RETRY_MS = 2_000;

export type AcceptedDiaryMessage = {
  accountId: string;
  sourceRecordId: string;
  eventId: string;
  receivedAt: string;
};

/** Account単位で連投と生成leaseを調停するDurable Object。本文の正本はD1にだけ置く。 */
export class ConversationCoordinator extends DurableObject<Env> {
  private readonly repository: ConversationCoordinatorRepository;
  private readonly cf: CloudflareBindings;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repository = new ConversationCoordinatorRepository(ctx.storage);
    this.cf = getCloudflareBindings(env);
    ctx.blockConcurrencyWhile(async () => this.repository.initialize());
  }

  async acceptMessage(input: AcceptedDiaryMessage): Promise<{ accepted: boolean }> {
    if (!this.repository.bindAccount(input.accountId)) {
      throw new Error("Conversation coordinator cannot accept messages from another account");
    }
    const existing = this.repository.findAcceptedMessage(input.eventId);
    if (existing) {
      if (
        existing.accountId !== input.accountId ||
        existing.sourceRecordId !== input.sourceRecordId ||
        existing.receivedAt !== new Date(input.receivedAt).getTime()
      ) {
        throw new Error("Accepted diary event conflicts with its persisted coordinator input");
      }
      return { accepted: false };
    }

    this.repository.addAcceptedMessage(input);
    const desiredAlarm = Date.now() + COALESCE_MS;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || desiredAlarm < currentAlarm) {
      await this.ctx.storage.setAlarm(desiredAlarm);
    }
    return { accepted: true };
  }

  async reserveReceipt(input: ReceiptReservation): Promise<{ accepted: boolean }> {
    if (!this.repository.bindAccount(input.accountId)) {
      throw new Error("Conversation coordinator cannot reserve receipts for another account");
    }
    const receivedAt = new Date(input.receivedAt).getTime();
    if (!Number.isFinite(receivedAt)) throw new Error("Receipt reservation time is invalid");
    const accepted = this.repository.addReceiptReservation(input.eventId, receivedAt);
    if (accepted) await this.schedulePendingWork();
    return { accepted };
  }

  async deliverTurn(input: TurnDeliveryRequest): Promise<TurnDeliveryResult> {
    const existing = this.repository.findTurnDelivery(
      input.turnId,
      input.generationEpoch,
      input.kind,
    );
    if (existing?.status === "delivered") return { status: "delivered" };
    if (existing?.status === "permanent_failure" || existing?.status === "delivery_unknown") {
      return { status: "permanent_failure" };
    }

    const opposite = this.repository.findTurnDelivery(
      input.turnId,
      input.generationEpoch,
      input.kind === "final" ? "failure" : "final",
    );
    if (opposite && opposite.status !== "permanent_failure") return { status: "superseded" };

    if (
      !this.repository.isLeaseActive(
        input.turnId,
        input.generationEpoch,
        input.leaseToken,
        Date.now(),
      )
    ) {
      return { status: "lease_expired" };
    }
    this.repository.stopPendingReceiptDeliveries();

    let delivery = existing;
    if (!delivery) {
      const target = await d1.action.account.findLineIdentityByAccountId(
        this.cf.d1,
        this.repository.getBoundAccountId() ?? "",
      );
      if (!target || !this.env.CHAT_DELIVERY_SECRET) {
        throw new Error("LINE delivery identity or secret is not configured");
      }
      if (
        !this.repository.isLeaseActive(
          input.turnId,
          input.generationEpoch,
          input.leaseToken,
          Date.now(),
        )
      ) {
        return { status: "lease_expired" };
      }
      const retryIdentity = `${input.kind}:${input.turnId}`;
      delivery = this.repository.createDelivery({
        id: retryIdentity,
        kind: input.kind,
        turnId: input.turnId,
        generationEpoch: input.generationEpoch,
        target,
        body: input.text,
        retryKey: await createLineRetryKey(this.env.CHAT_DELIVERY_SECRET, retryIdentity),
        status: "pending",
        deadlineAt: Date.now() + Math.max(1, this.currentLeaseDeadline(input.turnId) - Date.now()),
        createdAt: Date.now(),
      });
    }

    return this.sendTurnDelivery(delivery);
  }

  async acquireGeneration(turnId: string, generationEpoch: number): Promise<GenerationLease> {
    const turn = this.repository.findTurn(turnId);
    if (!turn || turn.generationEpoch !== generationEpoch) {
      return { acquired: false, reason: "stale" };
    }
    if (turn.status === "delivered" || turn.status === "failed") {
      return { acquired: false, reason: "completed" };
    }
    if (this.repository.findEarliestOpenTurnId() !== turnId) {
      return { acquired: false, reason: "busy" };
    }
    if (turn.status === "generating" && (turn.hardDeadlineAt ?? 0) > Date.now()) {
      return { acquired: false, reason: "busy" };
    }

    const leaseToken = crypto.randomUUID();
    const hardDeadlineAt = Date.now() + LEASE_MS;
    this.repository.startGeneration(turnId, leaseToken, hardDeadlineAt);
    await this.schedulePendingWork();
    return { acquired: true, leaseToken, hardDeadlineAt };
  }

  async isGenerationLeaseActive(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<boolean> {
    return this.repository.isLeaseActive(turnId, generationEpoch, leaseToken, Date.now());
  }

  async completeGeneration(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<boolean> {
    const current = this.repository.findTurn(turnId);
    if (
      !current ||
      current.status !== "generating" ||
      current.generationEpoch !== generationEpoch ||
      current.leaseToken !== leaseToken ||
      (current.hardDeadlineAt ?? 0) < Date.now()
    ) {
      return false;
    }
    this.repository.completeGeneration(turnId);
    this.cleanupTerminalState();
    await this.schedulePendingWork();
    return true;
  }

  async failGeneration(turnId: string, generationEpoch: number, leaseToken: string): Promise<void> {
    this.repository.failGeneration(turnId, generationEpoch, leaseToken);
    this.cleanupTerminalState();
    await this.schedulePendingWork();
  }

  async releaseGeneration(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<void> {
    this.repository.releaseGeneration(turnId, generationEpoch, leaseToken);
  }

  async alarm(): Promise<void> {
    try {
      await this.processAlarm();
    } catch (error) {
      logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        "Conversation coordinator alarm failed; retry scheduled",
      );
      const retryAt = Date.now() + ALARM_RETRY_MS;
      const leaseDeadline = this.repository.earliestLeaseDeadline();
      await this.ctx.storage.setAlarm(
        leaseDeadline === null ? retryAt : Math.min(retryAt, leaseDeadline),
      );
    }
  }

  private async processAlarm(): Promise<void> {
    this.cleanupTerminalState();
    this.repository.expirePendingDeliveries(Date.now());
    await this.prepareReceiptDelivery();
    for (const delivery of this.repository
      .listPendingDeliveries()
      .filter(({ kind }) => kind === "receipt")) {
      try {
        await this.sendDelivery(delivery);
      } catch (error) {
        if (delivery.deadlineAt > Date.now() && getLineDeliveryFailureKind(error) === "transient") {
          await this.scheduleDeliveryRetry(delivery.deadlineAt);
        }
      }
    }
    this.repository.expireGenerationLeases(Date.now());
    for (const turn of this.repository.listPendingQueueTurns()) {
      await this.enqueueTurn(turn.turnId, turn.generationEpoch);
    }

    let batch = this.repository.findAttachBatch();
    if (!batch) {
      const pending = this.repository.listPendingMessages();
      if (pending.length > 0) {
        const generationEpoch = this.repository.nextGenerationEpoch();
        this.repository.createAttachBatch(
          pending.map(({ eventId }) => eventId),
          generationEpoch,
        );
        batch = this.repository.findAttachBatch();
      }
    }
    if (!batch) {
      await this.schedulePendingWork();
      return;
    }

    const attached = await d1.action.conversation.attachMessagesToTurn(
      this.cf.d1,
      batch.messages.map((item) => ({
        eventId: item.eventId,
        accountId: item.accountId,
        sourceRecordId: item.sourceRecordId,
        receivedAt: new Date(item.receivedAt),
      })),
      batch.generationEpoch,
      this.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    );
    const isCurrentGeneration = attached.generationEpoch === batch.generationEpoch;
    this.repository.completeAttachBatch(
      batch.id,
      batch.messages.map(({ eventId }) => eventId),
      isCurrentGeneration
        ? { turnId: attached.turnId, generationEpoch: attached.generationEpoch }
        : undefined,
    );
    if (isCurrentGeneration) {
      await this.enqueueTurn(attached.turnId, attached.generationEpoch);
    }
    await this.schedulePendingWork();
  }

  private async enqueueTurn(turnId: string, generationEpoch: number): Promise<void> {
    const queue = this.cf.queue.chatTurn;
    if (!queue) throw new Error("CHAT_TURN_QUEUE binding is not configured");
    const message: ChatTurnQueueMessage = { type: "chat-turn", turnId, generationEpoch };
    await queue.send(message);
    this.repository.markTurnQueued(turnId);
  }

  private async schedulePendingWork(): Promise<void> {
    const pendingAlarm = this.repository.hasPendingWork() ? Date.now() + COALESCE_MS : null;
    const leaseDeadline = this.repository.earliestLeaseDeadline();
    const receiptAt = this.repository.earliestUnassignedReceiptAt();
    const receiptAlarm = receiptAt === null ? null : receiptAt + COALESCE_MS;
    const deliveryDeadline = this.repository.earliestDeliveryDeadline();
    const candidates = [pendingAlarm, leaseDeadline, receiptAlarm, deliveryDeadline].filter(
      (value): value is number => value !== null,
    );
    const desiredAlarm = candidates.length > 0 ? Math.min(...candidates) : null;
    if (desiredAlarm === null) return;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || desiredAlarm < currentAlarm) {
      await this.ctx.storage.setAlarm(desiredAlarm);
    }
  }

  private cleanupTerminalState(): void {
    this.repository.cleanupTerminalState(Date.now() - ACCEPTED_MESSAGE_RETENTION_MS);
  }

  private currentLeaseDeadline(turnId: string): number {
    return this.repository.findTurn(turnId)?.hardDeadlineAt ?? Date.now();
  }

  private async prepareReceiptDelivery(): Promise<void> {
    const reservations = this.repository.listUnassignedReceiptReservations();
    if (
      reservations.length === 0 ||
      (reservations[0]?.receivedAt ?? Date.now()) + COALESCE_MS > Date.now()
    ) {
      return;
    }
    const accountId = this.repository.getBoundAccountId();
    const target = accountId
      ? await d1.action.account.findLineIdentityByAccountId(this.cf.d1, accountId)
      : undefined;
    if (!target || !this.env.CHAT_DELIVERY_SECRET) {
      throw new Error("LINE receipt delivery is not configured");
    }
    const first = reservations[0];
    if (!first) return;
    const retryIdentity = `receipt:${first.eventId}`;
    const receivedAt = first.receivedAt;
    const coalescedReservations = reservations.filter(
      ({ receivedAt: candidateReceivedAt }) => candidateReceivedAt <= receivedAt + COALESCE_MS,
    );
    const body = this.env.LIFF_ID
      ? `受け付けました。少し考えてから返事をするね。\n今日の診断に答える\nhttps://liff.line.me/${this.env.LIFF_ID}`
      : "受け付けました。少し考えてから返事をするね。";
    this.repository.assignReceiptOutbox(
      coalescedReservations.map(({ eventId }) => eventId),
      {
        id: retryIdentity,
        kind: "receipt",
        target,
        body,
        retryKey: await createLineRetryKey(this.env.CHAT_DELIVERY_SECRET, retryIdentity),
        status: "pending",
        deadlineAt: receivedAt + RECEIPT_DEADLINE_MS,
        createdAt: Date.now(),
      },
    );
  }

  private async sendTurnDelivery(
    delivery: import("./repository").DeliveryOutboxRow,
  ): Promise<TurnDeliveryResult> {
    try {
      await this.sendDelivery(delivery);
      return { status: "delivered" };
    } catch (error) {
      if (delivery.deadlineAt <= Date.now() || getLineDeliveryFailureKind(error) === "permanent") {
        return { status: "permanent_failure" };
      }
      await this.scheduleDeliveryRetry(delivery.deadlineAt);
      throw error;
    }
  }

  private async sendDelivery(delivery: import("./repository").DeliveryOutboxRow): Promise<void> {
    if (delivery.deadlineAt <= Date.now()) {
      this.repository.markDeliveryStatus(delivery.id, "delivery_unknown");
      throw new Error("LINE delivery deadline expired");
    }
    if (!this.env.LINE_CHANNEL_ACCESS_TOKEN)
      throw new Error("LINE channel token is not configured");
    try {
      await pushLineTextWithRetryKey({
        channelAccessToken: this.env.LINE_CHANNEL_ACCESS_TOKEN,
        to: delivery.target,
        text: delivery.body,
        retryKey: delivery.retryKey,
      });
      this.repository.markDeliveryStatus(delivery.id, "delivered");
    } catch (error) {
      if (getLineDeliveryFailureKind(error) === "permanent") {
        this.repository.markDeliveryStatus(delivery.id, "permanent_failure");
      }
      throw error;
    }
  }

  private async scheduleDeliveryRetry(deadlineAt: number): Promise<void> {
    const jitter = new Uint16Array(1);
    crypto.getRandomValues(jitter);
    const desired = Math.min(
      Date.now() + DELIVERY_RETRY_MS + ((jitter[0] ?? 0) % DELIVERY_RETRY_MS),
      deadlineAt,
    );
    const current = await this.ctx.storage.getAlarm();
    if (current === null || desired < current) await this.ctx.storage.setAlarm(desired);
  }
}
