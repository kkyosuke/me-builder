import path from "node:path";
import { D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { D1AccountSessionVersionProvider } from "./d1-account-session-version-provider";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as D1.shared.Client;
}

describe("D1AccountSessionVersionProvider", () => {
  it("現在値の取得と両方の失効interfaceでversionを単調増加させる", async () => {
    const db = createTestDb();
    await db.insert(D1.shared.schema.accounts).values({ id: "account-1" });
    const provider = new D1AccountSessionVersionProvider(db);

    await expect(provider.current("account-1")).resolves.toBe(1);
    await expect(provider.invalidate("account-1")).resolves.toBe(2);
    await expect(provider.invalidateAccountSessions("account-1")).resolves.toBeUndefined();
    await expect(provider.current("account-1")).resolves.toBe(3);
  });

  it("D1障害を安全な運用分類へ変換する", async () => {
    const readProvider = new D1AccountSessionVersionProvider({
      query: {
        accounts: {
          findFirst: async () => {
            throw new Error("secret D1 response");
          },
        },
      },
    } as unknown as D1.shared.Client);

    await expect(readProvider.current("account-1")).rejects.toMatchObject({
      code: "SESSION_VERSION_READ_FAILED",
      category: "dependency",
      stage: "authentication.session.version.read",
      retryable: true,
      dependency: "cloudflare-d1",
    });

    const invalidationProvider = new D1AccountSessionVersionProvider({
      update: () => {
        throw new Error("secret D1 response");
      },
    } as unknown as D1.shared.Client);

    await expect(invalidationProvider.invalidate("account-1")).rejects.toMatchObject({
      code: "SESSION_VERSION_INVALIDATION_FAILED",
      category: "dependency",
      stage: "authentication.session.version.invalidate",
      retryable: true,
      dependency: "cloudflare-d1",
    });
  });
});
