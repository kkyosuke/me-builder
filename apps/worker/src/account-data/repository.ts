import { d1 } from "@me-builder/lib";
import { asc, eq, inArray } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle-account-data/migrations.js";
import { accountDataIdentity } from "./schema";

const accountDataSchema = { ...d1.schema, accountDataIdentity };
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
      .where(inArray(d1.schema.diagnosisBrainProjectionRequests.status, ["pending", "failed"]))
      .orderBy(asc(d1.schema.diagnosisBrainProjectionRequests.nextAttemptAt))
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
    ].filter((value): value is number => value !== null);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }
}
