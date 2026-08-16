import type { AccountDataNamespace } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import {
  listDevelopmentFailedBrainVectorSyncJobs,
  resetAllDevelopmentBrainVectorSyncJobs,
  resetDevelopmentBrainVectorSyncJob,
} from "./development-brain-vector-sync-jobs";

const accountData = {} as AccountDataNamespace;
const params = {
  actor: {
    accountId: "account-1",
    authenticationMethod: "liff" as const,
    authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
  },
  accountData,
};

function dependencies() {
  return {
    listFailed: vi.fn().mockResolvedValue({ jobs: [], truncated: false }),
    resetFailed: vi.fn().mockResolvedValue(true),
    resetAllFailed: vi.fn().mockResolvedValue(2),
  };
}

describe("development Brain Vector sync jobs", () => {
  it("本人確認で解決したAccountの終端jobを操作する", async () => {
    const deps = dependencies();

    await expect(listDevelopmentFailedBrainVectorSyncJobs(params, deps)).resolves.toEqual({
      type: "resolved",
      jobs: [],
      truncated: false,
    });
    await expect(
      resetDevelopmentBrainVectorSyncJob({ ...params, jobId: "job-1" }, deps),
    ).resolves.toEqual({ type: "resolved", reset: true });
    await expect(resetAllDevelopmentBrainVectorSyncJobs(params, deps)).resolves.toEqual({
      type: "resolved",
      resetCount: 2,
    });
    expect(deps.listFailed).toHaveBeenCalledWith(accountData, "account-1");
    expect(deps.resetFailed).toHaveBeenCalledWith(accountData, "account-1", "job-1");
    expect(deps.resetAllFailed).toHaveBeenCalledWith(accountData, "account-1");
  });
});
