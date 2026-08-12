import path from "node:path";
import {
  type AccountDataArgs,
  type AccountDataNamespace,
  type AccountDataOperation,
  type AccountDataResult,
  D1,
  DO,
} from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const actions = {
  "brain.listFailedVectorSyncJobs": (db: DO.account.Database, _accountId: string) =>
    DO.account.action.brain.listFailedBrainVectorSyncJobs(db),
  "brain.resetFailedVectorSyncJob": (
    db: DO.account.Database,
    _accountId: string,
    jobId: string,
    at?: Date,
  ) => DO.account.action.brain.resetFailedBrainVectorSyncJob(db, jobId, at),
  "brain.resetAllFailedVectorSyncJobs": (db: DO.account.Database, _accountId: string, at?: Date) =>
    DO.account.action.brain.resetAllFailedBrainVectorSyncJobs(db, at),
  "diagnosis.deleteAccountData": (db: DO.account.Database, accountId: string) =>
    DO.account.action.diagnosis.deleteAccountDiagnosisData(db, accountId),
  "diagnosis.deferQuestion": (
    db: DO.account.Database,
    accountId: string,
    input: Omit<
      Parameters<typeof DO.account.action.diagnosis.deferDiagnosisQuestion>[1],
      "accountId"
    >,
  ) => DO.account.action.diagnosis.deferDiagnosisQuestion(db, { ...input, accountId }),
  "diagnosis.saveAnswer": (
    db: DO.account.Database,
    accountId: string,
    input: Omit<Parameters<typeof DO.account.action.diagnosis.saveDiagnosisAnswer>[1], "accountId">,
  ) => DO.account.action.diagnosis.saveDiagnosisAnswer(db, { ...input, accountId }),
  "diagnosis.findAnswers": (
    db: DO.account.Database,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => DO.account.action.diagnosis.findDiagnosisAnswers(db, accountId, diagnosisId, at),
  "diagnosis.getAnsweredSource": (db: DO.account.Database, accountId: string, at: Date) =>
    DO.account.action.diagnosis.getDiagnosisAnsweredSource(db, accountId, at),
  "diagnosis.hasResponse": (db: DO.account.Database, accountId: string, diagnosisId: string) =>
    DO.account.action.diagnosis.hasDiagnosisResponse(db, accountId, diagnosisId),
  "diagnosis.listVisible": (db: DO.account.Database, accountId: string, at: Date) =>
    DO.account.action.diagnosis.listVisibleDiagnoses(db, accountId, at),
  "source.hasActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.source.hasActiveSourceRecords(db, accountId),
  "diagnosisProjection.processLatest": (
    db: DO.account.Database,
    accountId: string,
    diagnosisId: string,
    at?: Date,
  ) =>
    DO.account.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection(
      db,
      accountId,
      diagnosisId,
      at,
    ),
  "profileSummary.read": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
    allowUnchangedRegeneration?: boolean,
  ) =>
    DO.account.action.profileSummary.readProfileSummary(
      db,
      accountId,
      at,
      allowUnchangedRegeneration,
    ),
  "profileSummary.readCompatibilityShareProfile": (db: DO.account.Database, accountId: string) =>
    DO.account.action.profileSummary.readCompatibilityShareProfile(db, accountId),
  "profileSummary.requestGeneration": (
    db: DO.account.Database,
    accountId: string,
    requestedAt?: Date,
    allowUnchangedRegeneration?: boolean,
  ) =>
    DO.account.action.profileSummary.requestProfileSummaryGeneration(
      db,
      accountId,
      requestedAt,
      allowUnchangedRegeneration,
    ),
  "profileSummary.listUndispatchedGenerationIds": (
    db: DO.account.Database,
    accountId: string,
    at?: Date,
    limit?: number,
  ) =>
    DO.account.action.profileSummary.listUndispatchedProfileSummaryGenerationIds(
      db,
      accountId,
      at,
      limit,
    ),
  "profileSummary.markGenerationDispatched": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    dispatchedAt?: Date,
  ) =>
    DO.account.action.profileSummary.markProfileSummaryGenerationDispatched(
      db,
      accountId,
      generationId,
      dispatchedAt,
    ),
  "profileSummary.loadGenerationContext": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    startedAt?: Date,
  ) =>
    DO.account.action.profileSummary.loadProfileSummaryGenerationContext(
      db,
      accountId,
      generationId,
      startedAt,
    ),
  "profileSummary.completeGeneration": (
    db: DO.account.Database,
    accountId: string,
    input: Parameters<typeof DO.account.action.profileSummary.completeProfileSummaryGeneration>[2],
  ) => DO.account.action.profileSummary.completeProfileSummaryGeneration(db, accountId, input),
  "profileSummary.failGeneration": (
    db: DO.account.Database,
    accountId: string,
    generationId: string,
    message: string,
    failedAt?: Date,
  ) =>
    DO.account.action.profileSummary.failProfileSummaryGeneration(
      db,
      accountId,
      generationId,
      message,
      failedAt,
    ),
} as const;

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../../packages/lib/drizzle-do-account");

export type AccountDataTestStore = Readonly<{
  namespace: AccountDataNamespace;
  /** Account所有tableへ直接assertするためのdatabase。 */
  db: DO.account.Database;
  /** DOと同じく、共有D1の公開定義をsnapshotとして取り込む。 */
  syncCatalogFrom(shared: D1.shared.Client): Promise<void>;
  /** 生SQLでAccount所有tableを読み書きするfixture・assert用。 */
  raw: Database.Database;
  /** RPCより前にfixtureを入れる場合に、ObjectへAccountを固定する。 */
  bind(accountId: string): void;
}>;

/**
 * AccountData Objectのprivate SQLiteを、in-memoryのSQLiteで再現するtest double。
 *
 * 1 storeにつき1 Accountだけを固定し、共有D1 bindingをAccount所有データへ使わせない。
 */
export function createAccountDataTestStore(): AccountDataTestStore {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(sqlite, { schema: DO.account.schema });
  Object.assign(drizzleDb, {
    batch: async (queries: readonly PromiseLike<unknown>[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  });
  migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });
  const db = drizzleDb as unknown as DO.account.Database;

  let boundAccountId: string | undefined;
  const bindAccount = (accountId: string) => {
    if (boundAccountId === accountId) return;
    if (boundAccountId) throw new Error("AccountData test store cannot be used by another account");
    sqlite
      .prepare("INSERT INTO account_data_identity (singleton, account_id) VALUES (1, ?)")
      .run(accountId);
    boundAccountId = accountId;
  };

  const syncCatalogFrom = async (shared: D1.shared.Client) => {
    const [
      questions,
      questionVersions,
      questionChoices,
      scoringConfigs,
      diagnoses,
      diagnosisQuestions,
    ] = await Promise.all([
      shared.select().from(D1.shared.schema.questions),
      shared.select().from(D1.shared.schema.questionVersions),
      shared.select().from(D1.shared.schema.questionChoices),
      shared.select().from(D1.shared.schema.diagnosisScoringConfigs),
      shared.select().from(D1.shared.schema.diagnoses),
      shared.select().from(D1.shared.schema.diagnosisQuestions),
    ]);
    if (questions.length > 0) await db.insert(DO.account.schema.questions).values(questions);
    if (questionVersions.length > 0)
      await db.insert(DO.account.schema.questionVersions).values(questionVersions);
    if (questionChoices.length > 0)
      await db.insert(DO.account.schema.questionChoices).values(questionChoices);
    if (scoringConfigs.length > 0)
      await db.insert(DO.account.schema.diagnosisScoringConfigs).values(scoringConfigs);
    if (diagnoses.length > 0) await db.insert(DO.account.schema.diagnoses).values(diagnoses);
    if (diagnosisQuestions.length > 0)
      await db.insert(DO.account.schema.diagnosisQuestions).values(diagnosisQuestions);
  };

  const namespace: AccountDataNamespace = {
    getByName(name) {
      return {
        async execute<TOperation extends AccountDataOperation>(
          accountId: string,
          operation: TOperation,
          ...args: AccountDataArgs<TOperation>
        ): Promise<AccountDataResult<TOperation>> {
          if (accountId !== name) throw new Error("AccountData test routing mismatch");
          bindAccount(accountId);
          const action = actions[operation as keyof typeof actions];
          if (!action) throw new Error(`Unsupported AccountData test operation: ${operation}`);
          return (await (action as unknown as (...input: unknown[]) => Promise<unknown>)(
            db,
            accountId,
            ...args,
          )) as AccountDataResult<TOperation>;
        },
      };
    },
  };
  return { db, namespace, syncCatalogFrom, raw: sqlite, bind: bindAccount };
}
