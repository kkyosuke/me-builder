import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = 1_786_752_000;
const adminAccountId = "account-admin-e2e";
const userAccountId = "account-user-e2e";
const adminLineId = "line-admin-e2e";

let miniflare: Miniflare;
let database: D1Database;

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function prepareAccounts(db: D1Database): Promise<void> {
  await applyMigrations(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status, role)
         VALUES (?, ?, ?, 0, 'active', 'admin')`,
      )
      .bind(adminAccountId, timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind("identity-admin-e2e", timestamp, timestamp, adminAccountId, adminLineId),
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status, role)
         VALUES (?, ?, ?, 0, 'active', 'user')`,
      )
      .bind(userAccountId, timestamp + 1, timestamp + 1),
  ]);
  const shared = D1.shared.client.create(db);
  await D1.shared.action.agreement.acceptCurrentTerms(shared, adminAccountId);
  await D1.shared.action.profile.saveVerifiedDisplayName(shared, userAccountId, "山田 花子");
  await D1.shared.action.adminAccount.upsertAccountProgressionProjection(
    shared,
    userAccountId,
    {
      level: 2,
      growthValue: 7,
      currentLevelThreshold: 5,
      nextLevelThreshold: 20,
      collectedPieces: 2,
      activePieces: 2,
      categoryCount: 2,
      calculationVersion: 1,
      highestLevel: 2,
      isProcessing: false,
      recentChanges: [],
      milestoneCards: [],
    },
    new Date("2026-08-15T01:00:00.000Z"),
  );
}

describe("Admin Account list local E2E", () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "admin-accounts-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareAccounts(database);
  }, 90_000);

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => miniflare.dispose());

  it("管理者が名前と進行度projectionを検索できる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          iss: "https://access.line.me",
          sub: adminLineId,
          aud: "1234567890",
          iat: Math.floor(Date.now() / 1_000),
          exp: timestamp + 86_400,
          name: "管理者",
        }),
      ),
    );
    const response = await app.request(
      "/api/admin/accounts?query=%E5%B1%B1%E7%94%B0&sort=level",
      { headers: { Authorization: "Bearer known-token" } },
      { DB: database, LINE_LOGIN_CHANNEL_ID: "1234567890", ENVIRONMENT: "test" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      total: 1,
      nextCursor: null,
      accounts: [
        {
          id: userAccountId,
          displayName: "山田 花子",
          role: "user",
          status: "active",
          createdAt: new Date((timestamp + 1) * 1000).toISOString(),
          progression: {
            status: "ready",
            level: 2,
            calculationVersion: 1,
            collectedPieces: 2,
            activePieces: 2,
            lastGrowthAt: "2026-08-15T01:00:00.000Z",
            projectedAt: "2026-08-15T01:00:00.000Z",
          },
        },
      ],
    });
  });

  it("認証後に共有D1のroleを失ったAccountをrequestごとに拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          iss: "https://access.line.me",
          sub: adminLineId,
          aud: "1234567890",
          exp: timestamp + 86_400,
        }),
      ),
    );
    await database
      .prepare("UPDATE accounts SET role = 'user' WHERE id = ?")
      .bind(adminAccountId)
      .run();
    const response = await app.request(
      "/api/admin/accounts",
      { headers: { Authorization: "Bearer previously-admin-token" } },
      { DB: database, LINE_LOGIN_CHANNEL_ID: "1234567890", ENVIRONMENT: "test" },
    );
    expect(response.status).toBe(403);
    await database
      .prepare("UPDATE accounts SET role = 'admin' WHERE id = ?")
      .bind(adminAccountId)
      .run();
  });
});
