import { DurableObject } from "cloudflare:workers";
import { d1 } from "@me-builder/lib";
import type { ChatTurnQueueMessage } from "@me-builder/shared";
import { DEFAULT_GEMINI_MODEL } from "./config";
import type { Env } from "./types";

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
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
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
        INSERT OR IGNORE INTO coordinator_state(singleton, generation_epoch) VALUES (1, 0);
        CREATE TABLE IF NOT EXISTS local_turns (
          turn_id TEXT PRIMARY KEY,
          generation_epoch INTEGER NOT NULL,
          status TEXT NOT NULL,
          lease_token TEXT,
          hard_deadline_at INTEGER
        );
      `);
    });
  }

  async acceptMessage(input: AcceptedDiaryMessage): Promise<{ accepted: boolean }> {
    const existing = this.ctx.storage.sql
      .exec<{ event_id: string }>(
        "SELECT event_id FROM accepted_messages WHERE event_id = ?",
        input.eventId,
      )
      .toArray()[0];
    if (existing) return { accepted: false };

    this.ctx.storage.sql.exec(
      `INSERT INTO accepted_messages(event_id, account_id, source_record_id, received_at, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      input.eventId,
      input.accountId,
      input.sourceRecordId,
      new Date(input.receivedAt).getTime(),
    );
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + COALESCE_MS);
    return { accepted: true };
  }

  async acquireGeneration(turnId: string, generationEpoch: number): Promise<GenerationLease> {
    const turn = this.ctx.storage.sql
      .exec<{ status: string; generation_epoch: number; hard_deadline_at: number | null }>(
        "SELECT status, generation_epoch, hard_deadline_at FROM local_turns WHERE turn_id = ?",
        turnId,
      )
      .toArray()[0];
    if (!turn || turn.generation_epoch !== generationEpoch)
      return { acquired: false, reason: "stale" };
    if (turn.status === "delivered" || turn.status === "failed") {
      return { acquired: false, reason: "completed" };
    }
    const earliest = this.ctx.storage.sql
      .exec<{ turn_id: string }>(
        `SELECT turn_id FROM local_turns
         WHERE status NOT IN ('delivered', 'failed')
         ORDER BY generation_epoch LIMIT 1`,
      )
      .toArray()[0];
    if (earliest?.turn_id !== turnId) return { acquired: false, reason: "busy" };
    if (turn.status === "generating" && (turn.hard_deadline_at ?? 0) > Date.now()) {
      return { acquired: false, reason: "busy" };
    }

    const leaseToken = crypto.randomUUID();
    const hardDeadlineAt = Date.now() + LEASE_MS;
    this.ctx.storage.sql.exec(
      `UPDATE local_turns
       SET status = 'generating', lease_token = ?, hard_deadline_at = ?
       WHERE turn_id = ?`,
      leaseToken,
      hardDeadlineAt,
      turnId,
    );
    await this.schedulePendingWork();
    return { acquired: true, leaseToken, hardDeadlineAt };
  }

  async isGenerationLeaseActive(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<boolean> {
    const current = this.ctx.storage.sql
      .exec<{ hard_deadline_at: number | null }>(
        `SELECT hard_deadline_at FROM local_turns
         WHERE turn_id = ? AND generation_epoch = ? AND lease_token = ? AND status = 'generating'`,
        turnId,
        generationEpoch,
        leaseToken,
      )
      .toArray()[0];
    return Boolean(current && (current.hard_deadline_at ?? 0) >= Date.now());
  }

  async completeGeneration(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<boolean> {
    const current = this.ctx.storage.sql
      .exec<{
        generation_epoch: number;
        lease_token: string | null;
        hard_deadline_at: number | null;
      }>(
        `SELECT generation_epoch, lease_token, hard_deadline_at FROM local_turns
         WHERE turn_id = ? AND status = 'generating'`,
        turnId,
      )
      .toArray()[0];
    if (
      !current ||
      current.generation_epoch !== generationEpoch ||
      current.lease_token !== leaseToken ||
      (current.hard_deadline_at ?? 0) < Date.now()
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      "UPDATE local_turns SET status = 'delivered', lease_token = NULL WHERE turn_id = ?",
      turnId,
    );
    await this.schedulePendingWork();
    return true;
  }

  async failGeneration(turnId: string, generationEpoch: number, leaseToken: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `UPDATE local_turns SET status = 'failed', lease_token = NULL
       WHERE turn_id = ? AND generation_epoch = ? AND lease_token = ?`,
      turnId,
      generationEpoch,
      leaseToken,
    );
    await this.schedulePendingWork();
  }

  async releaseGeneration(
    turnId: string,
    generationEpoch: number,
    leaseToken: string,
  ): Promise<void> {
    this.ctx.storage.sql.exec(
      `UPDATE local_turns
       SET status = 'queued', lease_token = NULL, hard_deadline_at = NULL
       WHERE turn_id = ? AND generation_epoch = ? AND lease_token = ? AND status = 'generating'`,
      turnId,
      generationEpoch,
      leaseToken,
    );
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      `UPDATE local_turns
       SET status = 'pending_queue', lease_token = NULL, hard_deadline_at = NULL
       WHERE status = 'generating' AND hard_deadline_at <= ?`,
      Date.now(),
    );
    const queuedTurns = this.ctx.storage.sql
      .exec<{ turn_id: string; generation_epoch: number }>(
        "SELECT turn_id, generation_epoch FROM local_turns WHERE status = 'pending_queue' ORDER BY generation_epoch",
      )
      .toArray();
    for (const turn of queuedTurns) await this.enqueueTurn(turn.turn_id, turn.generation_epoch);

    const pending = this.ctx.storage.sql
      .exec<{
        event_id: string;
        account_id: string;
        source_record_id: string;
        received_at: number;
      }>(
        `SELECT event_id, account_id, source_record_id, received_at FROM accepted_messages
         WHERE status IN ('pending', 'attaching') ORDER BY received_at, event_id`,
      )
      .toArray();
    if (pending.length === 0) {
      await this.schedulePendingWork();
      return;
    }

    const currentEpoch = this.ctx.storage.sql
      .exec<{ generation_epoch: number }>(
        "SELECT generation_epoch FROM coordinator_state WHERE singleton = 1",
      )
      .one().generation_epoch;
    const generationEpoch = currentEpoch + 1;
    this.ctx.storage.sql.exec(
      "UPDATE coordinator_state SET generation_epoch = ? WHERE singleton = 1",
      generationEpoch,
    );
    for (const item of pending) {
      this.ctx.storage.sql.exec(
        "UPDATE accepted_messages SET status = 'attaching' WHERE event_id = ?",
        item.event_id,
      );
    }

    const attached = await d1.action.conversation.attachMessagesToTurn(
      d1.client.create(this.env.DB),
      pending.map((item) => ({
        eventId: item.event_id,
        accountId: item.account_id,
        sourceRecordId: item.source_record_id,
        receivedAt: new Date(item.received_at),
      })),
      generationEpoch,
      this.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    );
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO local_turns(turn_id, generation_epoch, status)
       VALUES (?, ?, 'pending_queue')`,
      attached.turnId,
      attached.generationEpoch,
    );
    for (const item of pending) {
      this.ctx.storage.sql.exec(
        "UPDATE accepted_messages SET status = 'attached' WHERE event_id = ?",
        item.event_id,
      );
    }
    await this.enqueueTurn(attached.turnId, attached.generationEpoch);
    await this.schedulePendingWork();
  }

  private async enqueueTurn(turnId: string, generationEpoch: number): Promise<void> {
    if (!this.env.CHAT_TURN_QUEUE) throw new Error("CHAT_TURN_QUEUE binding is not configured");
    const message: ChatTurnQueueMessage = { type: "chat-turn", turnId, generationEpoch };
    await this.env.CHAT_TURN_QUEUE.send(message);
    this.ctx.storage.sql.exec(
      "UPDATE local_turns SET status = 'queued' WHERE turn_id = ? AND status = 'pending_queue'",
      turnId,
    );
  }

  private async schedulePendingWork(): Promise<void> {
    const pending = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM accepted_messages WHERE status = 'pending'
         UNION ALL SELECT COUNT(*) AS count FROM local_turns WHERE status = 'pending_queue'`,
      )
      .toArray()
      .some(({ count }) => count > 0);
    const leaseDeadline = this.ctx.storage.sql
      .exec<{ deadline: number | null }>(
        "SELECT MIN(hard_deadline_at) AS deadline FROM local_turns WHERE status = 'generating'",
      )
      .toArray()[0]?.deadline;
    const desiredAlarm = pending ? Date.now() + COALESCE_MS : leaseDeadline;
    if (desiredAlarm == null) return;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || desiredAlarm < currentAlarm) {
      await this.ctx.storage.setAlarm(desiredAlarm);
    }
  }
}
