import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationCoordinator } from "./conversation-coordinator";
import type { Env } from "./types";

function createCoordinator() {
  const sqlite = new Database(":memory:");
  let alarm: number | null = null;
  const sql = {
    exec<T>(query: string, ...params: unknown[]) {
      if (params.length === 0 && query.includes(";")) {
        sqlite.exec(query);
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      const statement = sqlite.prepare(query);
      const rows = statement.reader ? (statement.all(...params) as T[]) : [];
      if (!statement.reader) statement.run(...params);
      return {
        toArray: () => rows,
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
    getAlarm: async () => alarm,
    setAlarm: async (value: number) => {
      alarm = value;
    },
  };
  const ctx = {
    storage,
    blockConcurrencyWhile: (callback: () => Promise<void>) => callback(),
  } as unknown as DurableObjectState;
  const coordinator = new ConversationCoordinator(ctx, {} as Env);
  return { coordinator, sql };
}

afterEach(() => {
  vi.useRealTimers();
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
