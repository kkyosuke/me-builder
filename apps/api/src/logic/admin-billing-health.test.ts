import path from "node:path";
import { D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { getAdminBillingHealth } from "./admin-billing-health";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle migratorをD1 clientと共用するtest adapter。
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as D1.shared.Client;
}

describe("admin billing health", () => {
  it("support担当が個人内容なしで未反映Customerを検知できる", async () => {
    const db = createTestDb();
    const owner = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "billing-health-owner",
    });
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.account.id,
      providerCustomerId: "cus-without-projection",
      syncedAt: new Date("2026-08-15T00:00:00Z"),
    });
    const outcome = await getAdminBillingHealth({
      idToken: "token",
      lineLoginChannelId: "channel",
      adminLineUserIds: [],
      db,
      staleAfterMs: 15 * 60 * 1_000,
      now: new Date("2026-08-15T01:00:00Z"),
      createSession: vi.fn().mockResolvedValue({
        type: "resolved",
        session: { accountId: crypto.randomUUID(), role: "admin" },
      }),
    });
    expect(outcome).toMatchObject({
      type: "resolved",
      health: {
        status: "degraded",
        customerCount: 1,
        customerWithoutProjectionCount: 1,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(owner.account.id);
    expect(JSON.stringify(outcome)).not.toContain("cus-without-projection");
  });

  it("一般利用者へ運用集計を返さない", async () => {
    await expect(
      getAdminBillingHealth({
        idToken: "token",
        lineLoginChannelId: "channel",
        adminLineUserIds: [],
        db: createTestDb(),
        staleAfterMs: 900_000,
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: crypto.randomUUID(), role: "user" },
        }),
      }),
    ).resolves.toEqual({ type: "forbidden" });
  });
});
