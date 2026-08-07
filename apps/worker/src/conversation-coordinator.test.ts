import { d1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationCoordinator } from "./conversation-coordinator";
import type { Env } from "./types";

function createCoordinator(env: Partial<Env> = {}) {
  const sqlite = new Database(":memory:");
  let alarm: number | null = null;
  const sql = {
    exec<T>(query: string, ...params: unknown[]) {
      if (params.length === 0 && query.includes(";")) {
        sqlite.exec(query);
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      const statement = sqlite.prepare(query);
      let rows: T[] = [];
      let rawRows: unknown[][] = [];
      try {
        rows = statement.reader ? (statement.all(...params) as T[]) : [];
        rawRows = statement.reader ? (statement.raw(true).all(...params) as unknown[][]) : [];
        if (!statement.reader) statement.run(...params);
      } catch (error) {
        throw new Error(
          `Test SQLite query failed with ${JSON.stringify(params)}: ${query}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return {
        toArray: () => rows,
        raw: () => ({ toArray: () => rawRows }),
        one: () => {
          const row = rows[0];
          if (!row) throw new Error("Expected one row");
          return row;
        },
      };
    },
  };
  const storage = {
    sql,
    transactionSync: (callback: () => void) => sqlite.transaction(callback)(),
    getAlarm: async () => alarm,
    setAlarm: async (value: number) => {
      alarm = value;
    },
  };
  const ctx = {
    storage,
    blockConcurrencyWhile: (callback: () => Promise<void>) => callback(),
  } as unknown as DurableObjectState;
  const coordinator = new ConversationCoordinator(ctx, env as Env);
  return { coordinator, sql, getAlarm: () => alarm };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConversationCoordinator recovery", () => {
  it("D1反映中のbatchへ後着messageを混ぜない", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { coordinator, sql } = createCoordinator({
      DB: {} as Env["DB"],
      CHAT_TURN_QUEUE: { send } as unknown as NonNullable<Env["CHAT_TURN_QUEUE"]>,
    });
    const receivedAt = new Date().toISOString();
    await coordinator.acceptMessage({
      accountId: "account-1",
      sourceRecordId: "source-1",
      eventId: "event-1",
      receivedAt,
    });
    sql.exec("UPDATE accepted_messages SET status = 'attaching' WHERE event_id = ?", "event-1");
    sql.exec("UPDATE coordinator_state SET generation_epoch = 1 WHERE singleton = 1");
    sql.exec("INSERT INTO attach_batches(id, generation_epoch) VALUES (?, ?)", "batch-1", 1);
    sql.exec(
      "INSERT INTO attach_batch_messages(event_id, batch_id) VALUES (?, ?)",
      "event-1",
      "batch-1",
    );
    await coordinator.acceptMessage({
      accountId: "account-1",
      sourceRecordId: "source-2",
      eventId: "event-2",
      receivedAt,
    });
    const attach = vi
      .spyOn(d1.action.conversation, "attachMessagesToTurn")
      .mockResolvedValueOnce({ turnId: "turn-1", sessionId: "session-1", generationEpoch: 1 })
      .mockResolvedValueOnce({ turnId: "turn-2", sessionId: "session-1", generationEpoch: 2 });

    await coordinator.alarm();
    expect(attach.mock.calls[0]?.[1].map(({ eventId }) => eventId)).toEqual(["event-1"]);
    expect(
      sql
        .exec<{ status: string }>(
          "SELECT status FROM accepted_messages WHERE event_id = ?",
          "event-2",
        )
        .one().status,
    ).toBe("pending");

    await coordinator.alarm();
    expect(attach.mock.calls[1]?.[1].map(({ eventId }) => eventId)).toEqual(["event-2"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("alarmの外部I/Oが失敗しても次回実行を予約する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
    const { coordinator, getAlarm } = createCoordinator({
      DB: {} as Env["DB"],
      CHAT_TURN_QUEUE: {
        send: vi.fn(),
      } as unknown as NonNullable<Env["CHAT_TURN_QUEUE"]>,
    });
    await coordinator.acceptMessage({
      accountId: "account-1",
      sourceRecordId: "source-1",
      eventId: "event-1",
      receivedAt: new Date().toISOString(),
    });
    vi.spyOn(d1.action.conversation, "attachMessagesToTurn").mockRejectedValue(
      new Error("temporary D1 outage"),
    );

    await expect(coordinator.alarm()).resolves.toBeUndefined();
    expect(getAlarm()).toBe(Date.now() + 30_000);
  });

  it("alarmの再試行より早い生成lease期限を上書きしない", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
    const { coordinator, getAlarm, sql } = createCoordinator({
      DB: {} as Env["DB"],
      CHAT_TURN_QUEUE: {
        send: vi.fn(),
      } as unknown as NonNullable<Env["CHAT_TURN_QUEUE"]>,
    });
    const leaseDeadline = Date.now() + 5_000;
    sql.exec(
      `INSERT INTO local_turns(turn_id, generation_epoch, status, lease_token, hard_deadline_at)
       VALUES (?, ?, 'generating', ?, ?)`,
      "turn-1",
      1,
      "lease-1",
      leaseDeadline,
    );
    await coordinator.acceptMessage({
      accountId: "account-1",
      sourceRecordId: "source-1",
      eventId: "event-1",
      receivedAt: new Date().toISOString(),
    });
    vi.spyOn(d1.action.conversation, "attachMessagesToTurn").mockRejectedValue(
      new Error("temporary D1 outage"),
    );

    await coordinator.alarm();

    expect(getAlarm()).toBe(leaseDeadline);
  });

  it("最初に固定したAccount以外のmessageを拒否する", async () => {
    const { coordinator } = createCoordinator();
    const input = {
      accountId: "account-1",
      sourceRecordId: "source-1",
      eventId: "event-1",
      receivedAt: new Date().toISOString(),
    };
    await expect(coordinator.acceptMessage(input)).resolves.toEqual({ accepted: true });
    await expect(coordinator.acceptMessage(input)).resolves.toEqual({ accepted: false });
    await expect(
      coordinator.acceptMessage({ ...input, accountId: "account-2", eventId: "event-2" }),
    ).rejects.toThrow("another account");
  });

  it("保持期間を過ぎた冪等キーと終端Turnを掃除する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
    const { coordinator, sql } = createCoordinator();
    sql.exec(
      `INSERT INTO accepted_messages(event_id, account_id, source_record_id, received_at, status)
       VALUES (?, ?, ?, ?, 'attached')`,
      "old-event",
      "account-1",
      "source-1",
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    );
    sql.exec(
      "INSERT INTO local_turns(turn_id, generation_epoch, status) VALUES (?, ?, 'delivered')",
      "old-turn",
      1,
    );

    await coordinator.alarm();
    expect(
      sql.exec<{ value: number }>("SELECT COUNT(*) AS value FROM accepted_messages").one().value,
    ).toBe(0);
    expect(
      sql.exec<{ value: number }>("SELECT COUNT(*) AS value FROM local_turns").one().value,
    ).toBe(0);
  });

  it("保持期間後の古いeventを既存Turnへ再投入しない", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { coordinator } = createCoordinator({
      DB: {} as Env["DB"],
      CHAT_TURN_QUEUE: { send } as unknown as NonNullable<Env["CHAT_TURN_QUEUE"]>,
    });
    await coordinator.acceptMessage({
      accountId: "account-1",
      sourceRecordId: "source-1",
      eventId: "event-1",
      receivedAt: new Date().toISOString(),
    });
    vi.spyOn(d1.action.conversation, "attachMessagesToTurn").mockResolvedValue({
      turnId: "old-turn",
      sessionId: "session-1",
      generationEpoch: 0,
    });

    await coordinator.alarm();

    expect(send).not.toHaveBeenCalled();
  });
});

describe("ConversationCoordinator generation lease", () => {
  it("同じTurnの重複consumerに有効なleaseを奪わせない", async () => {
    const { coordinator, sql } = createCoordinator();
    sql.exec(
      "INSERT INTO local_turns(turn_id, generation_epoch, status) VALUES (?, ?, 'queued')",
      "turn-1",
      1,
    );
    const first = await coordinator.acquireGeneration("turn-1", 1);
    expect(first.acquired).toBe(true);
    await expect(coordinator.acquireGeneration("turn-1", 1)).resolves.toEqual({
      acquired: false,
      reason: "busy",
    });
  });

  it("Queueの到着順に関係なく古いTurnを先に処理する", async () => {
    const { coordinator, sql } = createCoordinator();
    sql.exec(
      `INSERT INTO local_turns(turn_id, generation_epoch, status)
       VALUES ('turn-1', 1, 'queued'), ('turn-2', 2, 'queued')`,
    );
    await expect(coordinator.acquireGeneration("turn-2", 2)).resolves.toEqual({
      acquired: false,
      reason: "busy",
    });
    await expect(coordinator.acquireGeneration("turn-1", 1)).resolves.toMatchObject({
      acquired: true,
    });
  });

  it("期限切れleaseは同じTurnへ再発行できる", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { coordinator, sql } = createCoordinator();
    sql.exec(
      `INSERT INTO local_turns(turn_id, generation_epoch, status, lease_token, hard_deadline_at)
       VALUES (?, ?, 'generating', 'old-token', ?)`,
      "turn-1",
      1,
      Date.now() - 1,
    );
    const lease = await coordinator.acquireGeneration("turn-1", 1);
    expect(lease).toMatchObject({ acquired: true });
    if (lease.acquired) expect(lease.leaseToken).not.toBe("old-token");
  });
});
