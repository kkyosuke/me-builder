import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { saveBrainItem } from "./brain";
import {
  agreeGoalFollowUp,
  readGoalFollowUps,
  selectGoalFollowUpMemory,
  updateGoalFollowUp,
} from "./goal-follow-up";

const ACCOUNT_ID = "goal-account";
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

async function addGoal(
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
      category: "goal",
      statement: input.statement,
      attributes: { sourceKind: "diary", isInference: input.isInference ?? false },
      derivation: "ai",
      status: "active",
      validFrom: at,
      stability: "temporary",
      sensitivity: "normal",
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
    topicLabels: [{ id: `topic-${input.id}`, label: "diary" }],
  });
}

describe("goal follow-up", () => {
  it("本人が明言したGoalと次の一歩だけを合意対象にし、完了・停止・訂正できる", async () => {
    const db = createTestDb();
    await addGoal(db, { id: "confirmed", statement: "来週、上司との面談で希望を伝えたい" });
    await addGoal(db, { id: "inferred", statement: "運動を始めたい", isInference: true });

    await expect(readGoalFollowUps(db, ACCOUNT_ID, AT, true)).resolves.toMatchObject({
      items: [],
      candidates: [{ brainItemId: "confirmed", goal: "来週、上司との面談で希望を伝えたい" }],
    });

    await expect(
      agreeGoalFollowUp(db, ACCOUNT_ID, "inferred", "朝に10分歩く", AT),
    ).resolves.toEqual({ type: "goal-not-confirmed" });
    const agreed = await agreeGoalFollowUp(
      db,
      ACCOUNT_ID,
      "confirmed",
      "面談前に希望を一つ書く",
      AT,
    );
    expect(agreed).toMatchObject({ type: "agreed", item: { status: "active" } });
    if (agreed.type !== "agreed") throw new Error("goal agreement failed");
    await expect(
      updateGoalFollowUp(
        db,
        ACCOUNT_ID,
        agreed.item.id,
        { nextStep: "面談前に希望を二つ書く" },
        new Date(AT.getTime() + 1),
      ),
    ).resolves.toMatchObject({ type: "updated", item: { nextStep: "面談前に希望を二つ書く" } });
    await expect(
      updateGoalFollowUp(
        db,
        ACCOUNT_ID,
        agreed.item.id,
        { status: "completed" },
        new Date(AT.getTime() + 2),
      ),
    ).resolves.toMatchObject({ type: "updated", item: { status: "completed" } });
    const read = await readGoalFollowUps(db, ACCOUNT_ID, new Date(AT.getTime() + 3), true);
    expect(read.items).toHaveLength(1);
    expect(read.candidates).toEqual([
      { brainItemId: "confirmed", goal: "来週、上司との面談で希望を伝えたい" },
    ]);
  });

  it("候補を要求しない読取ではGoal本文を返さず、削除済みのGoalは保存済み状態にも返さない", async () => {
    const db = createTestDb();
    await addGoal(db, { id: "private-goal", statement: "週末に散歩したい" });
    const agreed = await agreeGoalFollowUp(
      db,
      ACCOUNT_ID,
      "private-goal",
      "土曜の朝に靴を出す",
      AT,
    );
    expect(agreed).toMatchObject({ type: "agreed" });

    await expect(readGoalFollowUps(db, ACCOUNT_ID, AT)).resolves.toMatchObject({
      items: [{ goal: "週末に散歩したい" }],
      candidates: [],
    });

    db.update(schema.brainItems)
      .set({
        isDeleted: true,
        deletedAt: new Date(AT.getTime() + 1),
        updatedAt: new Date(AT.getTime() + 1),
      })
      .where(eq(schema.brainItems.id, "private-goal"))
      .run();
    if (agreed.type !== "agreed") throw new Error("goal agreement failed");
    await expect(
      updateGoalFollowUp(
        db,
        ACCOUNT_ID,
        agreed.item.id,
        { status: "completed" },
        new Date(AT.getTime() + 2),
      ),
    ).resolves.toEqual({ type: "not-found" });
    await expect(
      readGoalFollowUps(db, ACCOUNT_ID, new Date(AT.getTime() + 2), true),
    ).resolves.toEqual({ items: [], candidates: [] });
  });

  it("Liteは選択中1件、Fullは複数のうち現在の話題に関係する1件だけを使う", async () => {
    const db = createTestDb();
    await addGoal(db, { id: "meeting", statement: "上司との面談で希望を伝えたい" });
    await addGoal(db, {
      id: "running",
      statement: "週末にランニングを続けたい",
      at: new Date(AT.getTime() + 1_000),
    });
    await agreeGoalFollowUp(db, ACCOUNT_ID, "meeting", "面談前に希望を書く", AT);
    await agreeGoalFollowUp(
      db,
      ACCOUNT_ID,
      "running",
      "土曜の朝に靴を出す",
      new Date(AT.getTime() + 1_000),
    );
    const afterAgreement = new Date(AT.getTime() + 2_000);

    await expect(
      selectGoalFollowUpMemory(db, ACCOUNT_ID, "selected-one", "今日は仕事の話", afterAgreement),
    ).resolves.toMatchObject({ brainItemId: "running" });
    await expect(
      selectGoalFollowUpMemory(
        db,
        ACCOUNT_ID,
        "relevant-active",
        "上司との面談が近づいてきた",
        afterAgreement,
      ),
    ).resolves.toMatchObject({
      brainItemId: "meeting",
      accessLabels: ["goal-follow-up"],
    });
    await expect(
      selectGoalFollowUpMemory(
        db,
        ACCOUNT_ID,
        "relevant-active",
        "夕食がおいしかった",
        afterAgreement,
      ),
    ).resolves.toBeNull();
  });

  it("Liteの進行中上限を合意・再開と同じAccountData操作内で判定する", async () => {
    const db = createTestDb();
    await addGoal(db, { id: "first", statement: "最初の目標" });
    await addGoal(db, { id: "second", statement: "次の目標" });
    const first = await agreeGoalFollowUp(db, ACCOUNT_ID, "first", "一歩進める", AT, 1);
    expect(first).toMatchObject({ type: "agreed" });

    await expect(
      agreeGoalFollowUp(db, ACCOUNT_ID, "second", "二歩目を進める", AT, 1),
    ).resolves.toEqual({ type: "active-limit-reached" });
    if (first.type !== "agreed") throw new Error("goal agreement failed");
    await expect(
      updateGoalFollowUp(db, ACCOUNT_ID, first.item.id, { status: "completed" }, AT, 1),
    ).resolves.toMatchObject({ type: "updated" });
    const second = await agreeGoalFollowUp(db, ACCOUNT_ID, "second", "二歩目を進める", AT, 1);
    expect(second).toMatchObject({ type: "agreed" });
    await expect(
      updateGoalFollowUp(db, ACCOUNT_ID, first.item.id, { status: "active" }, AT, 1),
    ).resolves.toEqual({ type: "active-limit-reached" });
  });

  it("本人が停止・完了したGoalをAI memoryへ自動で戻さない", async () => {
    const db = createTestDb();
    await addGoal(db, { id: "stopped", statement: "週末に散歩を続けたい" });
    await addGoal(db, { id: "completed", statement: "面談の準備を終えたい" });
    const stopped = await agreeGoalFollowUp(db, ACCOUNT_ID, "stopped", "靴を出す", AT);
    const completed = await agreeGoalFollowUp(db, ACCOUNT_ID, "completed", "希望を書く", AT);
    if (stopped.type !== "agreed" || completed.type !== "agreed") {
      throw new Error("goal agreement failed");
    }
    await updateGoalFollowUp(db, ACCOUNT_ID, stopped.item.id, { status: "stopped" }, AT);
    await updateGoalFollowUp(db, ACCOUNT_ID, completed.item.id, { status: "completed" }, AT);

    await expect(
      selectGoalFollowUpMemory(db, ACCOUNT_ID, "relevant-active", "散歩と面談の話", AT),
    ).resolves.toBeNull();
    await expect(readGoalFollowUps(db, ACCOUNT_ID, AT, false)).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ status: "stopped" }),
        expect.objectContaining({ status: "completed" }),
      ]),
    });
  });
});
