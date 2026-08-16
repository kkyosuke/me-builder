import {
  type AccountDataNamespace,
  type FailedBrainVectorSyncJobList,
  accountDataFor,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Params = {
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
};

type Dependencies = {
  listFailed: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => Promise<FailedBrainVectorSyncJobList>;
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

export type DevelopmentFailedBrainVectorSyncJobsOutcome = {
  type: "resolved";
} & FailedBrainVectorSyncJobList;

export type ResetDevelopmentBrainVectorSyncJobOutcome = { type: "resolved"; reset: boolean };

export type ResetAllDevelopmentBrainVectorSyncJobsOutcome = {
  type: "resolved";
  resetCount: number;
};

/** 本人確認済みAccountの終端Vector同期jobだけを開発用に返す。 */
export async function listDevelopmentFailedBrainVectorSyncJobs(
  { actor, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DevelopmentFailedBrainVectorSyncJobsOutcome> {
  const result = await dependencies.listFailed(accountData, actor.accountId);
  return { type: "resolved", ...result };
}

/** 本人確認済みAccountの指定した終端jobを再試行可能に戻す。 */
export async function resetDevelopmentBrainVectorSyncJob(
  { actor, accountData, jobId }: Params & { jobId: string },
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetDevelopmentBrainVectorSyncJobOutcome> {
  const reset = await dependencies.resetFailed(accountData, actor.accountId, jobId);
  return { type: "resolved", reset };
}

/** 本人確認済みAccountの全終端jobを再試行可能に戻す。 */
export async function resetAllDevelopmentBrainVectorSyncJobs(
  { actor, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetAllDevelopmentBrainVectorSyncJobsOutcome> {
  const resetCount = await dependencies.resetAllFailed(accountData, actor.accountId);
  return { type: "resolved", resetCount };
}
