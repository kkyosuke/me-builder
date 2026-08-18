import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { saveBrainItem } from "./brain";
import {
  confirmSelfCareContext,
  readSelfCareConfirmations,
  revokeSelfCareContext,
  selectSelfCareContextMemories,
} from "./self-care-context";

const ACCOUNT_ID = "self-care-account";
const AT = new Date("2026-08-16T00:00:00.000Z");

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  Object.assign(db, {
    batch: async (queries: readonly (PromiseLike<unknown> & { run(): unknown })[]) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: ACCOUNT_ID }).run();
  return db as unknown as AccountDataDatabase;
}

async function addItem(
  db: AccountDataDatabase,
  input: Readonly<{ id: string; statement: string; isInference?: boolean; at?: Date }>,
) {
  const at = input.at ?? AT;
  const sourceRecordId = `source-${input.id}`;
  await db.insert(schema.sourceRecords).values({
    id: sourceRecordId,
    accountId: ACCOUNT_ID,
    kind: "user_input",
    createdAt: at,
    updatedAt: at,
  });
  await db.insert(schema.sourceRecordTextPayloads).values({
    sourceRecordId,
    body: input.statement,
    contentHash: `hash-${input.id}`,
  });
  await saveBrainItem(db, {
    at,
    item: {
      id: input.id,
      accountId: ACCOUNT_ID,
      category: "memory",
      statement: input.statement,
      attributes: { sourceKind: "diary", isInference: input.isInference ?? false },
      derivation: "ai",
      status: "active",
      validFrom: at,
      stability: "temporary",
      sensitivity: "sensitive",
      externallyShareable: false,
      confidence: { state: "uncomputed" },
    },
    evidence: [
      {
        id: `evidence-${input.id}`,
        sourceRecordId,
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: at,
      },
    ],
    accessLabels: [{ id: `access-${input.id}`, label: "unclassified", assignedBy: "system" }],
    topicLabels: [{ id: `topic-${input.id}`, label: "self-care" }],
  });
}

describe("self-care context", () => {
  it("本人が明言した対処だけを確認し、撤回後は相談へ使わない", async () => {
    const db = createTestDb();
    await addItem(db, { id: "worked", statement: "予定を一つ減らすと少し楽になった" });
    await addItem(db, { id: "inferred", statement: "散歩が合いそう", isInference: true });
    await expect(readSelfCareConfirmations(db, ACCOUNT_ID, AT)).resolves.toMatchObject({
      items: [],
      candidates: [{ brainItemId: "worked", statement: "予定を一つ減らすと少し楽になった" }],
    });
    await expect(confirmSelfCareContext(db, ACCOUNT_ID, "inferred", "worked", AT)).resolves.toEqual(
      { type: "not-confirmed" },
    );
    const confirmed = await confirmSelfCareContext(db, ACCOUNT_ID, "worked", "worked", AT);
    expect(confirmed).toMatchObject({ type: "confirmed", item: { kind: "worked" } });
    if (confirmed.type !== "confirmed") throw new Error("confirmation failed");
    await expect(
      selectSelfCareContextMemories(db, ACCOUNT_ID, "personalized-history", AT),
    ).resolves.toMatchObject([{ brainItemId: "worked", accessLabels: ["self-care-worked"] }]);
    await revokeSelfCareContext(db, ACCOUNT_ID, confirmed.item.id, new Date(AT.getTime() + 1));
    await expect(
      readSelfCareConfirmations(db, ACCOUNT_ID, new Date(AT.getTime() + 2)),
    ).resolves.toMatchObject({
      candidates: [{ brainItemId: "worked", statement: "予定を一つ減らすと少し楽になった" }],
    });
    await expect(
      selectSelfCareContextMemories(
        db,
        ACCOUNT_ID,
        "personalized-history",
        new Date(AT.getTime() + 2),
      ),
    ).resolves.toEqual([]);
  });

  it("Liteは各種1件、Fullは複数履歴と直近30日の状態だけを使う", async () => {
    const db = createTestDb();
    const old = new Date(AT.getTime() - 31 * 24 * 60 * 60 * 1_000);
    for (const [id, statement, kind, at] of [
      ["worked-old", "早く寝ると楽だった", "worked", new Date(AT.getTime() - 2_000)],
      ["worked-new", "予定を減らすと楽だった", "worked", new Date(AT.getTime() - 1_000)],
      ["not-worked", "長い散歩は疲れた", "did-not-work", AT],
      ["old-state", "先月は眠れなかった", "recent-state", old],
      ["state", "今週は肩に力が入っている", "recent-state", AT],
    ] as const) {
      await addItem(db, { id, statement, at });
      await confirmSelfCareContext(db, ACCOUNT_ID, id, kind, at);
    }

    await expect(selectSelfCareContextMemories(db, ACCOUNT_ID, "general", AT)).resolves.toEqual([]);
    const lite = await selectSelfCareContextMemories(db, ACCOUNT_ID, "confirmed", AT);
    expect(
      lite.filter(({ accessLabels }) => accessLabels.includes("self-care-worked")),
    ).toHaveLength(1);
    const full = await selectSelfCareContextMemories(db, ACCOUNT_ID, "personalized-history", AT);
    expect(full.map(({ brainItemId }) => brainItemId)).toEqual(
      expect.arrayContaining(["worked-old", "worked-new", "not-worked", "state"]),
    );
    expect(full.map(({ brainItemId }) => brainItemId)).not.toContain("old-state");
  });
});
