import path from "node:path";
import { currentServiceTerms } from "@me-builder/shared";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { upsertIdentity } from "./account";
import {
  acceptCurrentTerms,
  findCurrentTermsAcceptance,
  listTermsAcceptanceHistory,
} from "./agreement";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzleのmigrator型はD1 clientと共用できない。
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      let results: unknown[] = [];
      sqlite.transaction(() => {
        results = queries.map((query) => (query as { run: () => unknown }).run());
      })();
      return results;
    },
  });
  return db as unknown as SharedD1Client;
}

describe("account agreement acceptance", () => {
  it("Accountと規約versionに紐づく同意日時を保存する", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_terms",
    });

    const accepted = await acceptCurrentTerms(db, account.id, new Date("2026-08-15T01:23:45.000Z"));

    expect(accepted).toMatchObject({
      accountId: account.id,
      documentKey: "terms_of_service",
      documentVersion: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
      acceptedAt: "2026-08-15T01:23:45.000Z",
    });
    await expect(findCurrentTermsAcceptance(db, account.id)).resolves.toMatchObject(accepted);
  });

  it("同じversionへの再同意で履歴を重複させず、最初の日時を維持する", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_terms_twice",
    });

    const first = await acceptCurrentTerms(db, account.id, new Date("2026-08-15T01:00:00Z"));
    const second = await acceptCurrentTerms(db, account.id, new Date("2026-08-15T02:00:00Z"));

    expect(second.id).toBe(first.id);
    expect(second.acceptedAt).toBe(first.acceptedAt);
    expect(await db.select().from(schema.accountAgreementAcceptances).all()).toHaveLength(1);
  });

  it("削除済みの同じversionへ再同意すると、新しい有効な履歴を追記する", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_terms_reaccept",
    });
    const first = await acceptCurrentTerms(db, account.id, new Date("2026-08-15T01:00:00Z"));
    const deletedAt = new Date("2026-08-15T01:30:00Z");
    await db
      .update(schema.accountAgreementAcceptances)
      .set({ isDeleted: true, deletedAt, updatedAt: deletedAt })
      .where(eq(schema.accountAgreementAcceptances.id, first.id));

    const second = await acceptCurrentTerms(db, account.id, new Date("2026-08-15T02:00:00Z"));

    expect(second).toMatchObject({
      accountId: account.id,
      documentVersion: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
      acceptedAt: "2026-08-15T02:00:00.000Z",
      isDeleted: false,
    });
    expect(second.id).not.toBe(first.id);
    const histories = await db.select().from(schema.accountAgreementAcceptances).all();
    expect(histories).toHaveLength(2);
    expect(histories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, isDeleted: true }),
        expect.objectContaining({ id: second.id, isDeleted: false }),
      ]),
    );
    await expect(findCurrentTermsAcceptance(db, account.id)).resolves.toMatchObject({
      id: second.id,
    });
    await expect(listTermsAcceptanceHistory(db, account.id)).resolves.toMatchObject([
      { id: second.id, isDeleted: false },
      { id: first.id, isDeleted: true },
    ]);
  });

  it("別Accountの記録を含めずに同意履歴を返す", async () => {
    const db = createTestDb();
    const first = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_terms_history_first",
    });
    const second = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_terms_history_second",
    });
    await acceptCurrentTerms(db, first.account.id, new Date("2026-08-15T01:00:00Z"));
    await acceptCurrentTerms(db, second.account.id, new Date("2026-08-15T02:00:00Z"));

    const history = await listTermsAcceptanceHistory(db, first.account.id);

    expect(history).toHaveLength(1);
    expect(history[0]?.accountId).toBe(first.account.id);
  });
});
