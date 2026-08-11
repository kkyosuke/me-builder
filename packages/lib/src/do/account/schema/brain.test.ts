import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { accountSchema as schema } from "../database";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  return db;
}

function insertItemFixture() {
  const db = createTestDb();
  db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" }).run();
  db.insert(schema.sourceRecords)
    .values({ id: "source-1", accountId: "account-1", kind: "user_input" })
    .run();
  db.insert(schema.brainItems)
    .values({
      id: "brain-1",
      accountId: "account-1",
      category: "preference",
      statement: "予定は事前に決める傾向がある",
      attributes: { sourceKind: "diary" },
      derivation: "ai",
      status: "active",
      stability: "changeable",
      sensitivity: "normal",
      confidence: { state: "uncomputed" },
    })
    .run();
  return db;
}

describe("Brain AccountData schema", () => {
  it("Evidenceと複数のAccess・Topic Labelを保存する", () => {
    const db = insertItemFixture();
    db.insert(schema.brainItemEvidenceEdges)
      .values({
        id: "edge-1",
        brainItemId: "brain-1",
        sourceRecordId: "source-1",
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: new Date("2026-08-08T00:00:00Z"),
      })
      .run();
    db.insert(schema.brainItemAccessLabels)
      .values([
        { id: "access-1", brainItemId: "brain-1", label: "work", assignedBy: "owner" },
        { id: "access-2", brainItemId: "brain-1", label: "private", assignedBy: "owner" },
      ])
      .run();
    db.insert(schema.brainItemTopicLabels)
      .values([
        { id: "topic-1", brainItemId: "brain-1", label: "career" },
        { id: "topic-2", brainItemId: "brain-1", label: "planning" },
      ])
      .run();

    expect(db.select().from(schema.brainItemAccessLabels).all()).toHaveLength(2);
    expect(db.select().from(schema.brainItemTopicLabels).all()).toHaveLength(2);
  });

  it("Objectに固定したAccount以外のSource Recordを保存できない", () => {
    const db = insertItemFixture();
    expect(() =>
      db
        .insert(schema.sourceRecords)
        .values({ id: "source-2", accountId: "account-2", kind: "user_input" })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("Objectに固定したAccount以外のBrain Itemを保存できない", () => {
    const db = insertItemFixture();
    expect(() =>
      db
        .insert(schema.brainItems)
        .values({
          id: "brain-2",
          accountId: "account-2",
          category: "memory",
          statement: "別AccountのItem",
          attributes: {},
          derivation: "ai",
          status: "active",
          stability: "stable",
          sensitivity: "normal",
          confidence: { state: "uncomputed" },
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("Objectへ2つ目のAccountを固定できない", () => {
    const db = insertItemFixture();
    expect(() =>
      db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-2" }).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("存在しないBrain ItemをEvidenceへ接続しない", () => {
    const db = insertItemFixture();
    expect(() =>
      db
        .insert(schema.brainItemEvidenceEdges)
        .values({
          id: "dangling-edge",
          brainItemId: "brain-missing",
          sourceRecordId: "source-1",
          relation: "supports",
          isDerivationTrigger: true,
          derivationMethod: "ai",
          generatedAt: new Date("2026-08-08T00:00:00Z"),
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("存在しないBrain ItemをRevisionへ接続しない", () => {
    const db = insertItemFixture();
    expect(() =>
      db
        .insert(schema.brainItemRevisions)
        .values({
          id: "dangling-revision",
          previousBrainItemId: "brain-1",
          nextBrainItemId: "brain-missing",
          derivationMethod: "ai",
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("Source Recordを物理削除してもEvidenceの来歴をcascade削除しない", () => {
    const db = insertItemFixture();
    db.insert(schema.brainItemEvidenceEdges)
      .values({
        id: "edge-1",
        brainItemId: "brain-1",
        sourceRecordId: "source-1",
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: new Date("2026-08-08T00:00:00Z"),
      })
      .run();

    expect(() =>
      db.delete(schema.sourceRecords).where(eq(schema.sourceRecords.id, "source-1")).run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(db.select().from(schema.brainItemEvidenceEdges).all()).toHaveLength(1);
  });
});
