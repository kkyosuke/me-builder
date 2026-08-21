import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import {
  findAccountByIdentity,
  linkIdentity,
  listActiveLineAccountIds,
  listLoginIdentityProviders,
  recordAccountActivity,
  resolveAccountByLineLogin,
  resolveAccountByLineMessagingApi,
  unlinkLoginIdentityProvider,
  upsertIdentity,
} from "./account";
import { acceptCurrentTerms } from "./agreement";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });

  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      let results: unknown[] = [];
      sqlite.transaction(() => {
        results = queries.map((query) => (query as { run: () => unknown }).run());
      })();
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

describe("listActiveLineAccountIds", () => {
  it("activeなLINE identityだけをAccount ID順にページングする", async () => {
    const db = createTestDb();
    const lineA = await upsertIdentity(db, { provider: "line", providerAccountId: "U_a" });
    const lineB = await upsertIdentity(db, { provider: "line", providerAccountId: "U_b" });
    await upsertIdentity(db, { provider: "google", providerAccountId: "google-only" });
    await acceptCurrentTerms(db, lineA.account.id);
    await acceptCurrentTerms(db, lineB.account.id);

    const expected = [lineA.account.id, lineB.account.id].sort();
    const firstAccountId = expected[0];
    const secondAccountId = expected[1];
    if (!firstAccountId || !secondAccountId) throw new Error("LINE Account fixtures are missing");
    await expect(listActiveLineAccountIds(db, { limit: 1 })).resolves.toEqual([firstAccountId]);
    await expect(
      listActiveLineAccountIds(db, { afterAccountId: firstAccountId, limit: 1 }),
    ).resolves.toEqual([secondAccountId]);
  });

  it("削除済みidentityと範囲外limitを受け付けない", async () => {
    const db = createTestDb();
    const deleted = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_deleted",
    });
    await acceptCurrentTerms(db, deleted.account.id);
    await db
      .update(schema.accountIdentities)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(schema.accountIdentities.id, deleted.identity.id));

    await expect(listActiveLineAccountIds(db)).resolves.toEqual([]);
    await expect(listActiveLineAccountIds(db, { limit: 101 })).rejects.toThrow(/between 1 and 100/);
  });
});

describe("recordAccountActivity", () => {
  it("最終利用時刻を15分単位で更新する", async () => {
    const db = createTestDb();
    const account = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_activity",
    });
    await db
      .update(schema.accounts)
      .set({ lastActivityAt: null })
      .where(eq(schema.accounts.id, account.account.id));
    const first = new Date("2026-08-20T00:00:00.000Z");
    await recordAccountActivity(db, account.account.id, first);
    await recordAccountActivity(db, account.account.id, new Date("2026-08-20T00:10:00.000Z"));
    expect(
      (
        await db.query.accounts.findFirst({
          where: (table, { eq }) => eq(table.id, account.account.id),
        })
      )?.lastActivityAt,
    ).toEqual(first);

    const later = new Date("2026-08-20T00:16:00.000Z");
    await recordAccountActivity(db, account.account.id, later);
    expect(
      (
        await db.query.accounts.findFirst({
          where: (table, { eq }) => eq(table.id, account.account.id),
        })
      )?.lastActivityAt,
    ).toEqual(later);
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

  it("Identity Platform Identityを既存Accountへ追加し、subjectを公開せずproviderを列挙すること", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_identity_platform_link",
    });

    await linkIdentity(db, {
      accountId: account.id,
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-private-uid",
    });

    await expect(
      findAccountByIdentity(db, "gcp_identity_platform", "identity-platform-private-uid"),
    ).resolves.toEqual(
      expect.objectContaining({ account: expect.objectContaining({ id: account.id }) }),
    );
    await expect(listLoginIdentityProviders(db, account.id)).resolves.toEqual([
      "gcp_identity_platform",
      "line_login",
    ]);
  });
});

describe("unlinkLoginIdentityProvider", () => {
  it("複数あるログイン手段からIdentity Platformだけを解除できること", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_unlink",
    });
    await linkIdentity(db, {
      accountId: account.id,
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-unlink",
    });

    await unlinkLoginIdentityProvider(db, {
      accountId: account.id,
      provider: "gcp_identity_platform",
    });

    await expect(listLoginIdentityProviders(db, account.id)).resolves.toEqual(["line_login"]);
    await expect(
      findAccountByIdentity(db, "gcp_identity_platform", "identity-platform-unlink"),
    ).resolves.toBeUndefined();
  });

  it("最後のIdentityは解除せず、再送しても他Accountへ影響しないこと", async () => {
    const db = createTestDb();
    const first = await upsertIdentity(db, {
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-only",
    });
    const other = await upsertIdentity(db, {
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-other",
    });

    await expect(
      unlinkLoginIdentityProvider(db, {
        accountId: first.account.id,
        provider: "gcp_identity_platform",
      }),
    ).rejects.toThrow("last login identity");
    await expect(listLoginIdentityProviders(db, first.account.id)).resolves.toEqual([
      "gcp_identity_platform",
    ]);
    await expect(listLoginIdentityProviders(db, other.account.id)).resolves.toEqual([
      "gcp_identity_platform",
    ]);
  });

  it("同じproviderのIdentityが複数あってもログイン手段をすべて解除しないこと", async () => {
    const db = createTestDb();
    const first = await upsertIdentity(db, {
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-first",
    });
    await linkIdentity(db, {
      accountId: first.account.id,
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-second",
    });

    await expect(
      unlinkLoginIdentityProvider(db, {
        accountId: first.account.id,
        provider: "gcp_identity_platform",
      }),
    ).rejects.toThrow("last login identity");
    await expect(listLoginIdentityProviders(db, first.account.id)).resolves.toEqual([
      "gcp_identity_platform",
      "gcp_identity_platform",
    ]);
  });

  it("別providerが残る場合は同じproviderのIdentityをまとめて解除できること", async () => {
    const db = createTestDb();
    const first = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_multiple_identity_platform",
    });
    await linkIdentity(db, {
      accountId: first.account.id,
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-first",
    });
    await linkIdentity(db, {
      accountId: first.account.id,
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-second",
    });

    await unlinkLoginIdentityProvider(db, {
      accountId: first.account.id,
      provider: "gcp_identity_platform",
    });

    await expect(listLoginIdentityProviders(db, first.account.id)).resolves.toEqual(["line_login"]);
  });
});

describe("resolveAccountByLineLogin", () => {
  it("該当するidentityが無ければWeb利用用のAccountとline_loginだけを作ること", async () => {
    const db = createTestDb();

    const resolved = await resolveAccountByLineLogin(db, "U_unknown");

    expect(resolved.identity.provider).toBe("line_login");
    expect(await db.select().from(schema.accounts).all()).toHaveLength(1);
    expect(await db.select().from(schema.accountIdentities).all()).toEqual([
      expect.objectContaining({ provider: "line_login", accountId: resolved.account.id }),
    ]);
    // 規約同意前なのでLINE通知・日々の声かけの対象にはしない。
    await expect(listActiveLineAccountIds(db)).resolves.toEqual([]);
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

  it("allowlistから外れた管理者を降格し、既存sessionをすべて失効すること", async () => {
    const db = createTestDb();
    const admin = await resolveAccountByLineLogin(db, "U_removed_admin", "admin");

    const resolved = await resolveAccountByLineLogin(db, "U_removed_admin", "user");

    expect(resolved.account.role).toBe("user");
    expect(resolved.account.sessionVersion).toBe(admin.account.sessionVersion + 1);
  });
});

describe("resolveAccountByLineMessagingApi", () => {
  it("空DBへの友だち追加でAccountと両方のLINE identityを作ること", async () => {
    const db = createTestDb();

    const resolved = await resolveAccountByLineMessagingApi(db, "U_follow_first");

    expect(resolved.identity.provider).toBe("line");
    expect(await db.select().from(schema.accounts).all()).toHaveLength(1);
    const identities = await db.select().from(schema.accountIdentities).all();
    expect(identities.map(({ provider }) => provider).sort()).toEqual(["line", "line_login"]);
    expect(new Set(identities.map(({ accountId }) => accountId))).toEqual(
      new Set([resolved.account.id]),
    );
    await expect(listActiveLineAccountIds(db)).resolves.toEqual([]);
    await acceptCurrentTerms(db, resolved.account.id);
    await expect(listActiveLineAccountIds(db)).resolves.toEqual([resolved.account.id]);
  });

  it("Webから作られたAccountへ後日のMessaging API identityを追加すること", async () => {
    const db = createTestDb();
    const webAccount = await resolveAccountByLineLogin(db, "U_web_first");

    const messagingAccount = await resolveAccountByLineMessagingApi(db, "U_web_first");

    expect(messagingAccount.account.id).toBe(webAccount.account.id);
    expect(await db.select().from(schema.accounts).all()).toHaveLength(1);
    const identities = await db.select().from(schema.accountIdentities).all();
    expect(identities.map(({ provider }) => provider).sort()).toEqual(["line", "line_login"]);
  });

  it("旧データのline identityへline_loginを補い、同じAccountを使うこと", async () => {
    const db = createTestDb();
    const existing = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_existing_line",
    });

    const resolved = await resolveAccountByLineMessagingApi(db, "U_existing_line");

    expect(resolved.account.id).toBe(existing.account.id);
    expect(await db.select().from(schema.accounts).all()).toHaveLength(1);
    expect(
      (await db.select().from(schema.accountIdentities).all())
        .map(({ provider }) => provider)
        .sort(),
    ).toEqual(["line", "line_login"]);
  });

  it("LIFFと友だち追加が同時でもAccountを二重作成しないこと", async () => {
    const db = createTestDb();

    const [login, messaging] = await Promise.all([
      resolveAccountByLineLogin(db, "U_concurrent_entry"),
      resolveAccountByLineMessagingApi(db, "U_concurrent_entry"),
    ]);

    expect(messaging.account.id).toBe(login.account.id);
    expect(await db.select().from(schema.accounts).all()).toHaveLength(1);
    expect(await db.select().from(schema.accountIdentities).all()).toHaveLength(2);
  });
});
