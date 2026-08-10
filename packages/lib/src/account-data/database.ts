import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import {
  catalogVersions,
  diagnoses,
  diagnosisQuestions,
  diagnosisScoringConfigs,
  questionChoices,
  questionVersions,
  questions,
} from "../shared-d1/schema/catalog";
import * as ownedTables from "./schema";

/**
 * 共有D1の公開定義をAccountData内へ複製したsnapshot。
 *
 * 正本は共有D1にあり、AccountDataは`catalog_versions`の版が進んだときだけ同期する。
 */
const catalogSnapshotTables = {
  catalogVersions,
  diagnoses,
  diagnosisQuestions,
  diagnosisScoringConfigs,
  questionChoices,
  questionVersions,
  questions,
};

/** AccountDataのprivate SQLiteが持つ全table。 */
export const accountDataSchema = {
  ...ownedTables,
  ...catalogSnapshotTables,
};

/**
 * AccountData専用のdatabase型。
 *
 * 共有D1のclient型とは別の型にすることで、Account所有データを扱うactionを
 * 共有D1のbindingから呼べないようにする。`batch`はDurable Objectの
 * `transactionSync`で実装され、repositoryが注入する。
 */
export type AccountDataDatabase = DrizzleSqliteDODatabase<typeof accountDataSchema> & {
  batch(statements: readonly BatchItem<"sqlite">[]): Promise<unknown[]>;
};
