import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AccountDataRepository } from "./repository";

function createRepository() {
  const sqlite = new Database(":memory:");
  const values = new Map<string, unknown>();
  const storage = {
    sql: {
      exec<T>(query: string, ...params: unknown[]) {
        if (params.length === 0 && query.includes(";")) {
          sqlite.exec(query);
          return { toArray: () => [] as T[], one: () => undefined as T };
        }
        const statement = sqlite.prepare(query);
        const rows = statement.reader ? (statement.all(...params) as T[]) : [];
        const rawRows = statement.reader ? (statement.raw(true).all(...params) as unknown[][]) : [];
        if (!statement.reader) statement.run(...params);
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
    },
    transactionSync: <T>(callback: () => T) => sqlite.transaction(callback)(),
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    put: (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
      return Promise.resolve();
    },
  } as unknown as DurableObjectStorage;
  return Object.assign(new AccountDataRepository(storage), { sqlite });
}

describe("AccountData avatar storage", () => {
  it("試験環境で旧0005が適用済みでも短くしたmigration bundleを起動できる", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.sqlite.exec("CREATE TABLE avatar_jobs (id text PRIMARY KEY NOT NULL)");
    repository.sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("retired-avatar-generation-migration", 1786322295246);

    await expect(repository.initialize()).resolves.toBeUndefined();
    expect(
      repository.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'avatar_jobs'")
        .get(),
    ).toEqual({ name: "avatar_jobs" });
  });

  it("現在画像の設定・変更間隔・参照・削除対象をAccount内で管理する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const at = new Date("2026-08-10T00:00:00.000Z");
    const first = {
      id: "avatar-1",
      objectKey: "accounts/account-1/avatar/images/avatar-1.webp",
      contentType: "image/webp",
    };

    await expect(repository.setCurrentAvatar(first, 0, at)).resolves.toMatchObject({
      type: "updated",
      state: { currentAvatar: { id: "avatar-1", updatedAt: at } },
    });
    await expect(repository.resolveAvatarImage("avatar-1")).resolves.toEqual({
      type: "resolved",
      objectKey: first.objectKey,
      contentType: "image/webp",
    });

    const interval = 7 * 24 * 60 * 60 * 1000;
    await expect(
      repository.setCurrentAvatar(
        { ...first, id: "avatar-2", objectKey: "avatar-2.webp" },
        interval,
        new Date("2026-08-11T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      type: "rate-limited",
      retryAt: new Date("2026-08-17T00:00:00.000Z"),
    });

    await expect(
      repository.deleteCurrentAvatar(interval, new Date("2026-08-17T00:00:00.000Z")),
    ).resolves.toEqual({ type: "deleted" });
    await expect(repository.resolveAvatarImage("avatar-1")).resolves.toEqual({
      type: "not-found",
    });
    await expect(
      repository.listDueAvatarObjectDeletions(new Date("2026-08-17T00:00:00.000Z")),
    ).resolves.toContainEqual(expect.objectContaining({ objectKey: first.objectKey }));
  });
});
