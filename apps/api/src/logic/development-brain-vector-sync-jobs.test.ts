import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import {
  listDevelopmentFailedBrainVectorSyncJobs,
  resetAllDevelopmentBrainVectorSyncJobs,
  resetDevelopmentBrainVectorSyncJob,
} from "./development-brain-vector-sync-jobs";

const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const params = {
  idToken: "token",
  lineLoginChannelId: "channel",
  db,
  accountData,
};

function dependencies() {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    }),
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

  it("本人を解決できなければAccountDataを操作しない", async () => {
    const deps = dependencies();
    deps.createSession.mockResolvedValue({ type: "unauthenticated", reason: "invalid" } as never);

    await expect(listDevelopmentFailedBrainVectorSyncJobs(params, deps)).resolves.toEqual({
      type: "unauthenticated",
      reason: "invalid",
    });
    expect(deps.listFailed).not.toHaveBeenCalled();
    expect(deps.resetFailed).not.toHaveBeenCalled();
    expect(deps.resetAllFailed).not.toHaveBeenCalled();
  });
});
