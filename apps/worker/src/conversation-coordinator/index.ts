import { DurableObject } from "cloudflare:workers";
import { d1 } from "@me-builder/lib";
import type { ChatTurnQueueMessage } from "@me-builder/shared";
import { DEFAULT_GEMINI_MODEL, getCloudflareBindings } from "../config";
import type { CloudflareBindings } from "../config";
import type { Env } from "../types";
import { ConversationCoordinatorRepository } from "./repository";

const COALESCE_MS = 1_500;
const LEASE_MS = 90_000;

export type AcceptedDiaryMessage = {
  accountId: string;
  sourceRecordId: string;
  eventId: string;
  receivedAt: string;
};

export type GenerationLease =
  | { acquired: true; leaseToken: string; hardDeadlineAt: number }
  | { acquired: false; reason: "busy" | "stale" | "completed" };

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
    if (this.repository.hasAcceptedMessage(input.eventId)) return { accepted: false };

    this.repository.addAcceptedMessage(input);
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + COALESCE_MS);
    return { accepted: true };
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
    await this.schedulePendingWork();
    return true;
  }

  async failGeneration(turnId: string, generationEpoch: number, leaseToken: string): Promise<void> {
    this.repository.failGeneration(turnId, generationEpoch, leaseToken);
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
    this.repository.expireGenerationLeases(Date.now());
    for (const turn of this.repository.listPendingQueueTurns()) {
      await this.enqueueTurn(turn.turnId, turn.generationEpoch);
    }

    const pending = this.repository.listPendingMessages();
    if (pending.length === 0) {
      await this.schedulePendingWork();
      return;
    }

    const generationEpoch = this.repository.nextGenerationEpoch();
    const eventIds = pending.map(({ eventId }) => eventId);
    this.repository.markMessagesAttaching(eventIds);

    const attached = await d1.action.conversation.attachMessagesToTurn(
      this.cf.d1,
      pending.map((item) => ({
        eventId: item.eventId,
        accountId: item.accountId,
        sourceRecordId: item.sourceRecordId,
        receivedAt: new Date(item.receivedAt),
      })),
      generationEpoch,
      this.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    );
    this.repository.addPendingTurn(attached.turnId, attached.generationEpoch);
    this.repository.markMessagesAttached(eventIds);
    await this.enqueueTurn(attached.turnId, attached.generationEpoch);
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
    const desiredAlarm = this.repository.hasPendingWork()
      ? Date.now() + COALESCE_MS
      : this.repository.earliestLeaseDeadline();
    if (desiredAlarm === null) return;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || desiredAlarm < currentAlarm) {
      await this.ctx.storage.setAlarm(desiredAlarm);
    }
  }
}
