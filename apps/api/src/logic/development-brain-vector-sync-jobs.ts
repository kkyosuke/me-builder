import {
  type AccountDataNamespace,
  type D1,
  type FailedBrainVectorSyncJob,
  accountDataFor,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type SessionFailure =
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  listFailed: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => Promise<readonly FailedBrainVectorSyncJob[]>;
  resetFailed: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    jobId: string,
  ) => Promise<boolean>;
  resetAllFailed: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => Promise<number>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listFailed: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("brain.listFailedVectorSyncJobs");
  },
  resetFailed: (accountData, accountId, jobId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("brain.resetFailedVectorSyncJob", jobId);
  },
  resetAllFailed: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("brain.resetAllFailedVectorSyncJobs");
  },
};

export type DevelopmentFailedBrainVectorSyncJobsOutcome =
  | { type: "resolved"; jobs: readonly FailedBrainVectorSyncJob[] }
  | SessionFailure;

export type ResetDevelopmentBrainVectorSyncJobOutcome =
  | { type: "resolved"; reset: boolean }
  | SessionFailure;

export type ResetAllDevelopmentBrainVectorSyncJobsOutcome =
  | { type: "resolved"; resetCount: number }
  | SessionFailure;

/** 本人確認済みAccountの終端Vector同期jobだけを開発用に返す。 */
export async function listDevelopmentFailedBrainVectorSyncJobs(
  { idToken, lineLoginChannelId, db, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DevelopmentFailedBrainVectorSyncJobsOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  const jobs = await dependencies.listFailed(accountData, session.session.accountId);
  return { type: "resolved", jobs };
}

/** 本人確認済みAccountの指定した終端jobを再試行可能に戻す。 */
export async function resetDevelopmentBrainVectorSyncJob(
  { idToken, lineLoginChannelId, db, accountData, jobId }: Params & { jobId: string },
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetDevelopmentBrainVectorSyncJobOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  const reset = await dependencies.resetFailed(accountData, session.session.accountId, jobId);
  return { type: "resolved", reset };
}

/** 本人確認済みAccountの全終端jobを再試行可能に戻す。 */
export async function resetAllDevelopmentBrainVectorSyncJobs(
  { idToken, lineLoginChannelId, db, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetAllDevelopmentBrainVectorSyncJobsOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  const resetCount = await dependencies.resetAllFailed(accountData, session.session.accountId);
  return { type: "resolved", resetCount };
}
