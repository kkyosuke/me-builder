import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { linkIdentity, resolveAccountByLineLogin, upsertIdentity } from "./account";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });

  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const q of queries) {
        results.push(await q);
      }
      return results;
    },
    writable: true,
  });

  return db as unknown as SharedD1Client;
}

describe("upsertIdentity", () => {
  it("should create new account and identity when identity does not exist", async () => {
    const db = createTestDb();
    const result = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line_user_123",
    });

    expect(result.account.id).toBeDefined();
    expect(result.account.status).toBe("active");
    expect(result.identity.accountId).toBe(result.account.id);
    expect(result.identity.provider).toBe("line");
    expect(result.identity.providerAccountId).toBe("line_user_123");
  });

  it("should update and return existing account and identity on second call", async () => {
    const db = createTestDb();
    const result1 = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line_user_reuse",
    });

    const result2 = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line_user_reuse",
    });

    expect(result2.account.id).toBe(result1.account.id);
    expect(result2.identity.id).toBe(result1.identity.id);
  });

  it("運用設定でadminを指定した新規・既存identityを管理者にすること", async () => {
    const db = createTestDb();
    const created = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_admin_new",
      role: "admin",
    });
    expect(created.account.role).toBe("admin");

    const existing = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_promote_later",
    });
    expect(existing.account.role).toBe("user");
    const promoted = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_promote_later",
      role: "admin",
    });
    expect(promoted.account.role).toBe("admin");
  });
});

describe("linkIdentity", () => {
  it("既存の Account へ別のログイン手段を追加できること", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_same",
    });

    const identity = await linkIdentity(db, {
      accountId: account.id,
      provider: "line_login",
      providerAccountId: "U_same",
    });

    expect(identity.accountId).toBe(account.id);
    expect(identity.provider).toBe("line_login");

    const identities = await db.select().from(schema.accountIdentities).all();
    expect(identities).toHaveLength(2);
    // 1 Account に複数のログイン手段がぶら下がる（マイグレーション不要で成立する）
    expect(new Set(identities.map((i) => i.accountId)).size).toBe(1);
  });

  it("同じ Account へ二度呼んでも identity が増えないこと", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_twice",
    });

    const first = await linkIdentity(db, {
      accountId: account.id,
      provider: "line_login",
      providerAccountId: "U_twice",
    });
    const second = await linkIdentity(db, {
      accountId: account.id,
      provider: "line_login",
      providerAccountId: "U_twice",
    });

    expect(second.id).toBe(first.id);
    expect(await db.select().from(schema.accountIdentities).all()).toHaveLength(2);
  });

  it("他の Account へ紐づいている identity を奪わないこと", async () => {
    const db = createTestDb();
    const owner = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_owned",
    });
    const other = await upsertIdentity(db, { provider: "line", providerAccountId: "U_other" });

    await expect(
      linkIdentity(db, {
        accountId: other.account.id,
        provider: "line_login",
        providerAccountId: "U_owned",
      }),
    ).rejects.toThrow(/already linked/);

    const identities = await db.select().from(schema.accountIdentities).all();
    expect(identities.find((i) => i.providerAccountId === "U_owned")?.accountId).toBe(
      owner.account.id,
    );
  });
});

describe("resolveAccountByLineLogin", () => {
  it("該当する identity が無ければ undefined を返し、Account を作らないこと", async () => {
    const db = createTestDb();

    const resolved = await resolveAccountByLineLogin(db, "U_unknown");

    expect(resolved).toBeUndefined();
    expect(await db.select().from(schema.accounts).all()).toHaveLength(0);
  });

  it("userId が一致する場合（同一プロバイダー）に friends 追加で作られた Account を引き当て、line_login を紐づけること", async () => {
    const db = createTestDb();
    // 友だち追加時に Messaging API の userId で作られた Account
    const followed = await upsertIdentity(db, { provider: "line", providerAccountId: "U_caseA" });

    const resolved = await resolveAccountByLineLogin(db, "U_caseA");

    expect(resolved?.account.id).toBe(followed.account.id);
    expect(resolved?.identity.provider).toBe("line_login");
    // Account は増えない
    expect(await db.select().from(schema.accounts).all()).toHaveLength(1);
  });

  it("同じ sub で同時に解決しても 500 にならず、identity が 1 本だけ増えること", async () => {
    const db = createTestDb();
    const followed = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_concurrent",
    });

    // 初回に LIFF を開いたときの二重実行 (StrictMode の二重 effect、リロード、2 タブ)
    const results = await Promise.allSettled([
      resolveAccountByLineLogin(db, "U_concurrent"),
      resolveAccountByLineLogin(db, "U_concurrent"),
    ]);

    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    for (const r of results) {
      if (r.status === "fulfilled") {
        expect(r.value?.account.id).toBe(followed.account.id);
      }
    }
    expect(await db.select().from(schema.accountIdentities).all()).toHaveLength(2);
  });

  it("2 回目以降は line_login の identity から直接解決すること", async () => {
    const db = createTestDb();
    const followed = await upsertIdentity(db, { provider: "line", providerAccountId: "U_second" });

    const first = await resolveAccountByLineLogin(db, "U_second");
    const second = await resolveAccountByLineLogin(db, "U_second");

    expect(second?.account.id).toBe(followed.account.id);
    expect(second?.identity.id).toBe(first?.identity.id);
    expect(await db.select().from(schema.accountIdentities).all()).toHaveLength(2);
  });

  it("既存Accountを管理者として解決した場合にroleを昇格すること", async () => {
    const db = createTestDb();
    await upsertIdentity(db, { provider: "line", providerAccountId: "U_admin" });

    const resolved = await resolveAccountByLineLogin(db, "U_admin", "admin");

    expect(resolved?.account.role).toBe("admin");
  });
});
