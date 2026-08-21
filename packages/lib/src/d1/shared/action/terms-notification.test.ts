import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { upsertIdentity } from "./account";
import { acceptCurrentTerms } from "./agreement";
import { listPendingTermsLineRecipients, recordTermsLineNotification } from "./terms-notification";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 test adapter
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

describe("terms notification", () => {
  it("現行規約へ同意済みのLINE Accountへversionごとに一度だけ配信する", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_notice",
    });
    await db.insert(schema.accountIdentities).values({
      id: "second-active-line-identity",
      accountId: target.account.id,
      provider: "line",
      providerAccountId: "U_notice_secondary",
    });
    await acceptCurrentTerms(db, target.account.id);
    await upsertIdentity(db, { provider: "line", providerAccountId: "U_unaccepted" });

    await expect(
      listPendingTermsLineRecipients(db, { documentVersion: "2026-09-10" }),
    ).resolves.toEqual([{ accountId: target.account.id, providerAccountId: "U_notice" }]);

    await recordTermsLineNotification(db, {
      accountId: target.account.id,
      documentVersion: "2026-09-10",
      disposition: "delivered",
      deliveredAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    await recordTermsLineNotification(db, {
      accountId: target.account.id,
      documentVersion: "2026-09-10",
      disposition: "delivered",
      deliveredAt: new Date("2026-08-21T00:01:00.000Z"),
    });

    await expect(
      listPendingTermsLineRecipients(db, { documentVersion: "2026-09-10" }),
    ).resolves.toEqual([]);
    expect(await db.select().from(schema.accountTermsNotifications)).toHaveLength(1);
  });
});
