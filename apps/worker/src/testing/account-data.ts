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
import { aiUsageActions } from "../account-data/ai-usage";
import { brainActions } from "../account-data/brain";
import { diagnosisActions } from "../account-data/diagnosis";
import { diaryActions } from "../account-data/diary";

const actions = {
  ...aiUsageActions,
  ...brainActions,
  ...diagnosisActions,
  ...diaryActions,
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

  return {
    db,
    syncCatalogFrom,
    raw: sqlite,
    bind: bindAccount,
    namespace: {
      getByName(name) {
        return {
          async execute<TOperation extends AccountDataOperation>(
            accountId: string,
            operation: TOperation,
            ...args: AccountDataArgs<TOperation>
          ): Promise<AccountDataResult<TOperation>> {
            if (accountId !== name) throw new Error("AccountData test routing mismatch");
            bindAccount(accountId);
            const action = (actions as Partial<Record<AccountDataOperation, unknown>>)[operation];
            if (!action) throw new Error(`Unsupported AccountData test operation: ${operation}`);
            return (await (action as unknown as (...input: unknown[]) => Promise<unknown>)(
              db,
              accountId,
              ...args,
            )) as AccountDataResult<TOperation>;
          },
        };
      },
    },
  };
}
