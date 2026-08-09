import { d1 } from "@me-builder/lib";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/account-data/migrations.js";
import { accountDataIdentity } from "./schema";

const accountDataSchema = {
  accountDataIdentity,
  accounts: d1.schema.accounts,
  brainItemAccessLabels: d1.schema.brainItemAccessLabels,
  brainItemEvidenceEdges: d1.schema.brainItemEvidenceEdges,
  brainItemRevisions: d1.schema.brainItemRevisions,
  brainItemTopicLabels: d1.schema.brainItemTopicLabels,
  brainItems: d1.schema.brainItems,
  chatTurns: d1.schema.chatTurns,
  conversationMessages: d1.schema.conversationMessages,
  conversationSessions: d1.schema.conversationSessions,
  diaryBrainCheckpoints: d1.schema.diaryBrainCheckpoints,
  sourceRecordTextPayloads: d1.schema.sourceRecordTextPayloads,
  diagnoses: d1.schema.diagnoses,
  diagnosisAnswers: d1.schema.diagnosisAnswers,
  diagnosisBrainProjectionHeads: d1.schema.diagnosisBrainProjectionHeads,
  diagnosisBrainProjectionRequests: d1.schema.diagnosisBrainProjectionRequests,
  diagnosisDeferredQuestions: d1.schema.diagnosisDeferredQuestions,
  diagnosisQuestions: d1.schema.diagnosisQuestions,
  diagnosisResponses: d1.schema.diagnosisResponses,
  diagnosisScoringConfigs: d1.schema.diagnosisScoringConfigs,
  questionChoices: d1.schema.questionChoices,
  questionVersions: d1.schema.questionVersions,
  questions: d1.schema.questions,
  sourceRecordRevisions: d1.schema.sourceRecordRevisions,
  sourceRecords: d1.schema.sourceRecords,
};
const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000;
const SESSION_HARD_CAP_MS = 24 * 60 * 60 * 1000;
type AccountDataDatabase = DrizzleSqliteDODatabase<typeof accountDataSchema>;
type ExecutableStatement = { all(): unknown };

export type DiagnosisCatalogSnapshot = Readonly<{
  questions: (typeof d1.schema.questions.$inferSelect)[];
  questionVersions: (typeof d1.schema.questionVersions.$inferSelect)[];
  questionChoices: (typeof d1.schema.questionChoices.$inferSelect)[];
  scoringConfigs: (typeof d1.schema.diagnosisScoringConfigs.$inferSelect)[];
  diagnoses: (typeof d1.schema.diagnoses.$inferSelect)[];
  diagnosisQuestions: (typeof d1.schema.diagnosisQuestions.$inferSelect)[];
}>;

export type LegacyAccountDataSnapshot = Readonly<{
  account: typeof d1.schema.accounts.$inferSelect | undefined;
  sourceRecords: (typeof d1.schema.sourceRecords.$inferSelect)[];
  sourceRecordTextPayloads: (typeof d1.schema.sourceRecordTextPayloads.$inferSelect)[];
  sourceRecordRevisions: (typeof d1.schema.sourceRecordRevisions.$inferSelect)[];
  brainItems: (typeof d1.schema.brainItems.$inferSelect)[];
  brainItemEvidenceEdges: (typeof d1.schema.brainItemEvidenceEdges.$inferSelect)[];
  brainItemRevisions: (typeof d1.schema.brainItemRevisions.$inferSelect)[];
  brainItemAccessLabels: (typeof d1.schema.brainItemAccessLabels.$inferSelect)[];
  brainItemTopicLabels: (typeof d1.schema.brainItemTopicLabels.$inferSelect)[];
  conversationSessions: (typeof d1.schema.conversationSessions.$inferSelect)[];
  conversationMessages: (typeof d1.schema.conversationMessages.$inferSelect)[];
  chatTurns: (typeof d1.schema.chatTurns.$inferSelect)[];
  diagnosisResponses: (typeof d1.schema.diagnosisResponses.$inferSelect)[];
  diagnosisAnswers: (typeof d1.schema.diagnosisAnswers.$inferSelect)[];
  diagnosisDeferredQuestions: (typeof d1.schema.diagnosisDeferredQuestions.$inferSelect)[];
  diagnosisBrainProjectionRequests: (typeof d1.schema.diagnosisBrainProjectionRequests.$inferSelect)[];
  diagnosisBrainProjectionHeads: (typeof d1.schema.diagnosisBrainProjectionHeads.$inferSelect)[];
}>;

/** AccountDataのprivate SQLiteと、既存action用の互換clientを所有する。 */
export class AccountDataRepository {
  private readonly storage: DurableObjectStorage;
  private readonly database: AccountDataDatabase;
  readonly client: d1.Client;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.database = drizzle(storage, { schema: accountDataSchema });
    this.client = this.database as unknown as d1.Client;
    Object.defineProperty(this.client, "batch", {
      configurable: false,
      value: async (statements: ExecutableStatement[]) =>
        this.storage.transactionSync(() => statements.map((statement) => statement.all())),
    });
  }

  async initialize(): Promise<void> {
    await migrate(this.database, migrations);
  }

  bindAccount(accountId: string): void {
    const existing = this.database
      .select({ accountId: accountDataIdentity.accountId })
      .from(accountDataIdentity)
      .where(eq(accountDataIdentity.singleton, 1))
      .get();
    if (existing && existing.accountId !== accountId) {
      throw new Error("AccountData Object cannot be used by another account");
    }
    if (existing) return;

    this.storage.transactionSync(() => {
      this.database
        .insert(d1.schema.accounts)
        .values({ id: accountId })
        .onConflictDoNothing()
        .run();
      this.database
        .insert(accountDataIdentity)
        .values({ singleton: 1, accountId })
        .onConflictDoNothing()
        .run();
    });
  }

  isLegacyImportComplete(): boolean {
    return Boolean(
      this.database
        .select({ importedAt: accountDataIdentity.legacyImportedAt })
        .from(accountDataIdentity)
        .where(eq(accountDataIdentity.singleton, 1))
        .get()?.importedAt,
    );
  }

  /** 旧共有D1のAccount所有行を、参照順序を保ってprivate SQLiteへ一度だけcopyする。 */
  importLegacyAccountData(snapshot: LegacyAccountDataSnapshot, importedAt = new Date()): void {
    if (this.isLegacyImportComplete()) return;
    const insertRows = <TRow>(
      rows: TRow[],
      insert: (row: TRow) => { onConflictDoNothing(): { run(): unknown } },
    ) => {
      for (const row of rows) insert(row).onConflictDoNothing().run();
    };

    this.storage.transactionSync(() => {
      if (snapshot.account) {
        this.database
          .insert(d1.schema.accounts)
          .values(snapshot.account)
          .onConflictDoUpdate({ target: d1.schema.accounts.id, set: snapshot.account })
          .run();
      }
      insertRows(snapshot.sourceRecords, (row) =>
        this.database.insert(d1.schema.sourceRecords).values(row),
      );
      insertRows(snapshot.sourceRecordTextPayloads, (row) =>
        this.database.insert(d1.schema.sourceRecordTextPayloads).values(row),
      );
      insertRows(snapshot.sourceRecordRevisions, (row) =>
        this.database.insert(d1.schema.sourceRecordRevisions).values(row),
      );
      insertRows(snapshot.brainItems, (row) =>
        this.database.insert(d1.schema.brainItems).values(row),
      );
      insertRows(snapshot.brainItemEvidenceEdges, (row) =>
        this.database.insert(d1.schema.brainItemEvidenceEdges).values(row),
      );
      insertRows(snapshot.brainItemRevisions, (row) =>
        this.database.insert(d1.schema.brainItemRevisions).values(row),
      );
      insertRows(snapshot.brainItemAccessLabels, (row) =>
        this.database.insert(d1.schema.brainItemAccessLabels).values(row),
      );
      insertRows(snapshot.brainItemTopicLabels, (row) =>
        this.database.insert(d1.schema.brainItemTopicLabels).values(row),
      );
      insertRows(snapshot.conversationSessions, (row) =>
        this.database.insert(d1.schema.conversationSessions).values(row),
      );
      insertRows(snapshot.conversationMessages, (row) =>
        this.database.insert(d1.schema.conversationMessages).values({ ...row, turnId: null }),
      );
      insertRows(snapshot.chatTurns, (row) =>
        this.database.insert(d1.schema.chatTurns).values({ ...row, responseMessageId: null }),
      );
      for (const row of snapshot.conversationMessages) {
        if (!row.turnId) continue;
        this.database
          .update(d1.schema.conversationMessages)
          .set({ turnId: row.turnId })
          .where(eq(d1.schema.conversationMessages.id, row.id))
          .run();
      }
      for (const row of snapshot.chatTurns) {
        if (!row.responseMessageId) continue;
        this.database
          .update(d1.schema.chatTurns)
          .set({ responseMessageId: row.responseMessageId })
          .where(eq(d1.schema.chatTurns.id, row.id))
          .run();
      }
      insertRows(snapshot.diagnosisResponses, (row) =>
        this.database.insert(d1.schema.diagnosisResponses).values(row),
      );
      insertRows(snapshot.diagnosisAnswers, (row) =>
        this.database.insert(d1.schema.diagnosisAnswers).values(row),
      );
      insertRows(snapshot.diagnosisDeferredQuestions, (row) =>
        this.database.insert(d1.schema.diagnosisDeferredQuestions).values(row),
      );
      insertRows(snapshot.diagnosisBrainProjectionRequests, (row) =>
        this.database.insert(d1.schema.diagnosisBrainProjectionRequests).values(row),
      );
      insertRows(snapshot.diagnosisBrainProjectionHeads, (row) =>
        this.database.insert(d1.schema.diagnosisBrainProjectionHeads).values(row),
      );
      this.assertImportedIds(
        "source_records",
        "id",
        snapshot.sourceRecords.map(({ id }) => id),
      );
      this.assertImportedIds(
        "source_record_text_payloads",
        "source_record_id",
        snapshot.sourceRecordTextPayloads.map(({ sourceRecordId }) => sourceRecordId),
      );
      this.assertImportedIds(
        "source_record_revisions",
        "id",
        snapshot.sourceRecordRevisions.map(({ id }) => id),
      );
      this.assertImportedIds(
        "brain_items",
        "id",
        snapshot.brainItems.map(({ id }) => id),
      );
      this.assertImportedIds(
        "brain_item_evidence_edges",
        "id",
        snapshot.brainItemEvidenceEdges.map(({ id }) => id),
      );
      this.assertImportedIds(
        "brain_item_revisions",
        "id",
        snapshot.brainItemRevisions.map(({ id }) => id),
      );
      this.assertImportedIds(
        "brain_item_access_labels",
        "id",
        snapshot.brainItemAccessLabels.map(({ id }) => id),
      );
      this.assertImportedIds(
        "brain_item_topic_labels",
        "id",
        snapshot.brainItemTopicLabels.map(({ id }) => id),
      );
      this.assertImportedIds(
        "conversation_sessions",
        "id",
        snapshot.conversationSessions.map(({ id }) => id),
      );
      this.assertImportedIds(
        "conversation_messages",
        "id",
        snapshot.conversationMessages.map(({ id }) => id),
      );
      this.assertImportedIds(
        "chat_turns",
        "id",
        snapshot.chatTurns.map(({ id }) => id),
      );
      this.assertImportedIds(
        "diagnosis_responses",
        "id",
        snapshot.diagnosisResponses.map(({ id }) => id),
      );
      this.assertImportedIds(
        "diagnosis_answers",
        "id",
        snapshot.diagnosisAnswers.map(({ id }) => id),
      );
      this.assertImportedIds(
        "diagnosis_deferred_questions",
        "id",
        snapshot.diagnosisDeferredQuestions.map(({ id }) => id),
      );
      this.assertImportedIds(
        "diagnosis_brain_projection_requests",
        "id",
        snapshot.diagnosisBrainProjectionRequests.map(({ id }) => id),
      );
      this.assertImportedIds(
        "diagnosis_brain_projection_heads",
        "id",
        snapshot.diagnosisBrainProjectionHeads.map(({ id }) => id),
      );
      if (this.storage.sql.exec("PRAGMA foreign_key_check").toArray().length > 0) {
        throw new Error("Legacy AccountData import failed foreign key validation");
      }
      this.database
        .update(accountDataIdentity)
        .set({ legacyImportedAt: importedAt })
        .where(eq(accountDataIdentity.singleton, 1))
        .run();
    });
  }

  private assertImportedIds(table: string, column: string, expectedIds: string[]): void {
    const actualIds = this.storage.sql
      .exec<{ id: string }>(`SELECT ${column} AS id FROM ${table}`)
      .toArray()
      .map(({ id }) => id)
      .sort();
    const expected = [...expectedIds].sort();
    if (
      actualIds.length !== expected.length ||
      actualIds.some((id, index) => id !== expected[index])
    ) {
      throw new Error(`Legacy AccountData import mismatch: ${table}`);
    }
  }

  syncDiagnosisCatalog(snapshot: DiagnosisCatalogSnapshot): void {
    this.storage.transactionSync(() => {
      for (const row of snapshot.questions) {
        this.database
          .insert(d1.schema.questions)
          .values(row)
          .onConflictDoUpdate({ target: d1.schema.questions.id, set: row })
          .run();
      }
      for (const row of snapshot.questionVersions) {
        this.database
          .insert(d1.schema.questionVersions)
          .values(row)
          .onConflictDoUpdate({
            target: [d1.schema.questionVersions.questionId, d1.schema.questionVersions.version],
            set: row,
          })
          .run();
      }
      for (const row of snapshot.questionChoices) {
        this.database
          .insert(d1.schema.questionChoices)
          .values(row)
          .onConflictDoUpdate({
            target: [
              d1.schema.questionChoices.questionId,
              d1.schema.questionChoices.questionVersion,
              d1.schema.questionChoices.choiceId,
            ],
            set: row,
          })
          .run();
      }
      for (const row of snapshot.scoringConfigs) {
        this.database
          .insert(d1.schema.diagnosisScoringConfigs)
          .values(row)
          .onConflictDoUpdate({ target: d1.schema.diagnosisScoringConfigs.id, set: row })
          .run();
      }
      for (const row of snapshot.diagnoses) {
        this.database
          .insert(d1.schema.diagnoses)
          .values(row)
          .onConflictDoUpdate({ target: d1.schema.diagnoses.id, set: row })
          .run();
      }
      for (const row of snapshot.diagnosisQuestions) {
        this.database
          .insert(d1.schema.diagnosisQuestions)
          .values(row)
          .onConflictDoUpdate({ target: d1.schema.diagnosisQuestions.id, set: row })
          .run();
      }
    });
  }

  /** Active diary sessionと未処理projectionのうち、最も早いmaintenance時刻を返す。 */
  nextMaintenanceAt(): number | null {
    const session = this.database
      .select({
        startedAt: d1.schema.conversationSessions.startedAt,
        lastUserMessageAt: d1.schema.conversationSessions.lastUserMessageAt,
      })
      .from(d1.schema.conversationSessions)
      .where(eq(d1.schema.conversationSessions.status, "active"))
      .get();
    const projection = this.database
      .select({ nextAttemptAt: d1.schema.diagnosisBrainProjectionRequests.nextAttemptAt })
      .from(d1.schema.diagnosisBrainProjectionRequests)
      .where(
        and(
          inArray(d1.schema.diagnosisBrainProjectionRequests.status, ["pending", "failed"]),
          eq(d1.schema.diagnosisBrainProjectionRequests.isDeleted, false),
        ),
      )
      .orderBy(asc(d1.schema.diagnosisBrainProjectionRequests.nextAttemptAt))
      .limit(1)
      .get();
    const diaryBrainCheckpoint = this.database
      .select({ nextAttemptAt: d1.schema.diaryBrainCheckpoints.nextAttemptAt })
      .from(d1.schema.diaryBrainCheckpoints)
      .where(
        and(
          eq(d1.schema.diaryBrainCheckpoints.status, "pending"),
          eq(d1.schema.diaryBrainCheckpoints.isDeleted, false),
        ),
      )
      .orderBy(asc(d1.schema.diaryBrainCheckpoints.nextAttemptAt))
      .limit(1)
      .get();
    const candidates = [
      session
        ? Math.min(
            session.startedAt.getTime() + SESSION_HARD_CAP_MS,
            session.lastUserMessageAt.getTime() + SESSION_INACTIVITY_MS,
          )
        : null,
      projection?.nextAttemptAt.getTime() ?? null,
      diaryBrainCheckpoint?.nextAttemptAt.getTime() ?? null,
    ].filter((value): value is number => value !== null);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }
}
