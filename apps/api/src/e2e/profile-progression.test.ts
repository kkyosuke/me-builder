import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1, DO } from "@me-builder/lib";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = 1_786_752_000;
const accountId = "account-progression-e2e";
const e2eSetupTimeoutMs = 90_000;

let miniflare: Miniflare;
let database: D1Database;
let accountDataStore: AccountDataTestStore;

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    const migration = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function prepareAccount(db: D1Database): Promise<void> {
  await applyMigrations(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind(accountId, timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind("identity-progression-e2e", timestamp, timestamp, accountId, "line-progression-e2e"),
  ]);
  await D1.shared.action.agreement.acceptCurrentTerms(D1.shared.client.create(db), accountId);
}

function mockLineVerification(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        iss: "https://access.line.me",
        sub: "line-progression-e2e",
        aud: "1234567890",
        iat: Math.floor(Date.now() / 1_000),
        exp: timestamp + 86_400,
      }),
    ),
  );
}

async function request(): Promise<Response> {
  return await app.request(
    "/api/profile/progression",
    { headers: { Authorization: "Bearer known-token" } },
    {
      DB: database,
      ACCOUNT_DATA: accountDataStore.namespace,
      LINE_LOGIN_CHANNEL_ID: "1234567890",
      ENVIRONMENT: "test",
    },
  );
}

async function addBrainItem(
  id: string,
  category: string,
  sourceCount: number,
  at: Date,
): Promise<void> {
  accountDataStore.bind(accountId);
  const sources = [];
  for (let index = 0; index < sourceCount; index += 1) {
    sources.push(
      await DO.account.action.diary.storeLineTextSource(accountDataStore.db, {
        accountId,
        eventId: `${id}-event-${index}`,
        body: `${id}の根拠${index}`,
        receivedAt: new Date(at.getTime() + index),
      }),
    );
  }
  await expect(
    DO.account.action.brain.saveBrainItem(accountDataStore.db, {
      at,
      item: {
        id,
        accountId,
        category,
        statement: `${id} statement`,
        attributes: {},
        derivation: "deterministic",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: {},
      },
      evidence: sources.map(({ sourceRecordId }, index) => ({
        id: `${id}-edge-${index}`,
        sourceRecordId,
        relation: "supports" as const,
        isDerivationTrigger: index === 0,
        derivationMethod: "deterministic" as const,
        generatedAt: new Date(at.getTime() + index),
      })),
      accessLabels: [
        {
          id: `${id}-access-label`,
          label: "unclassified",
          assignedBy: "system",
        },
      ],
    }),
  ).resolves.toEqual({ type: "saved", brainItemId: id });
}

describe("Profile progression API local E2E", () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "profile-progression-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareAccount(database);
  }, e2eSetupTimeoutMs);

  beforeEach(() => {
    accountDataStore = createAccountDataTestStore();
    mockLineVerification();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => miniflare.dispose());

  it("診断がなくてもLv.1を返し、Brain追加と削除を実データで反映する", async () => {
    const empty = await request();
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      level: 1,
      growthValue: 0,
      currentLevelThreshold: 0,
      nextLevelThreshold: 5,
      collectedPieces: 0,
      activePieces: 0,
      categoryCount: 0,
      calculationVersion: 1,
      highestLevel: 1,
      isProcessing: false,
      recentChanges: [],
      milestoneCards: [],
    });

    const at = new Date("2026-08-15T01:00:00.000Z");
    await addBrainItem("brain-a", "preference", 2, at);
    await addBrainItem("brain-b", "goal", 1, new Date(at.getTime() + 10));
    const grown = await request();
    expect(grown.headers.get("cache-control")).toBe("no-store");
    expect(await grown.json()).toMatchObject({
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
      recentChanges: expect.arrayContaining([
        expect.objectContaining({ kind: "new_piece", growthDelta: 3 }),
        expect.objectContaining({ kind: "evidence_deepened", growthDelta: 1 }),
      ]),
      milestoneCards: [],
    });

    await accountDataStore.db
      .update(DO.account.schema.brainItems)
      .set({ isDeleted: true, deletedAt: at, updatedAt: at })
      .where(eq(DO.account.schema.brainItems.id, "brain-b"));
    const afterDeletion = await request();
    expect(await afterDeletion.json()).toMatchObject({
      level: 2,
      growthValue: 7,
      collectedPieces: 2,
      activePieces: 1,
      categoryCount: 1,
      calculationVersion: 1,
      highestLevel: 2,
      isProcessing: false,
    });
  });
});
