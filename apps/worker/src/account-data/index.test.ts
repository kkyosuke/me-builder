import { D1, DO } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountData } from ".";

describe("AccountData compatibility projection reconciliation", () => {
  it("承諾正本のacceptedAtで予約参照を有効化する", async () => {
    const acceptedAt = new Date("2026-08-12T00:15:00.000Z");
    const activateCompatibilityReference = vi.fn().mockReturnValue({ outcome: "activated" });
    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-a",
      repository: {
        listReconciliableCompatibilityReferences: () => [
          { relationshipId: "1".repeat(64), role: "inviter", status: "reserved" },
        ],
        activateCompatibilityReference,
        listVisibleCompatibilityReferences: () => [],
      },
      env: {
        COMPATIBILITY_DATA: {
          getByName: () => ({
            getRelationship: vi.fn().mockResolvedValue({
              inviterAccountId: "account-a",
              inviteeAccountId: "account-b",
              acceptedAt,
            }),
          }),
        },
      },
    });

    await (
      instance as unknown as {
        listVisibleCompatibilityReferences(): Promise<unknown>;
      }
    ).listVisibleCompatibilityReferences();

    expect(activateCompatibilityReference).toHaveBeenCalledWith("account-a", {
      relationshipId: "1".repeat(64),
      partnerAccountId: "account-b",
      role: "inviter",
      updatedAt: acceptedAt,
    });
  });
});

describe("AccountData progression projection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("確定した本人進行度だけを共有D1へ同期し、同じ値を再書き込みしない", async () => {
    const progression = {
      level: 2,
      growthValue: 7,
      currentLevelThreshold: 5,
      nextLevelThreshold: 20,
      collectedPieces: 2,
      activePieces: 2,
      categoryCount: 2,
    };
    const shared = {} as D1.shared.Client;
    vi.spyOn(D1.shared.client, "create").mockReturnValue(shared);
    const upsert = vi
      .spyOn(D1.shared.action.adminAccount, "upsertAccountProgressionProjection")
      .mockResolvedValue();
    let storedState: unknown;
    const putProjectionState = vi.fn(async (_key: string, value: unknown) => {
      storedState = value;
    });
    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-1",
      repository: { client: {} },
      ctx: {
        storage: {
          get: vi.fn(async () => storedState),
          put: putProjectionState,
        },
      },
      env: { DB: {} },
    });

    await (
      instance as unknown as {
        syncProgressionProjection(value: typeof progression): Promise<void>;
      }
    ).syncProgressionProjection(progression);
    await (
      instance as unknown as {
        syncProgressionProjection(value: typeof progression): Promise<void>;
      }
    ).syncProgressionProjection(progression);

    expect(upsert).toHaveBeenCalledWith(shared, "account-1", progression, expect.any(Date));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(putProjectionState).toHaveBeenCalledWith("progressionProjectionState", {
      retryPending: false,
      calculationVersion: 1,
      growthValue: 7,
      collectedPieces: 2,
      activePieces: 2,
    });
  });
});

describe("AccountData alarm", () => {
  beforeEach(() => {
    vi.spyOn(
      DO.account.action.profileSummary,
      "listUndispatchedProfileSummaryGenerationIds",
    ).mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("未配送のProfile Summary生成要求をQueueへ投入して配送済みにする", async () => {
    const send = vi.fn(async () => undefined);
    const markDispatched = vi
      .spyOn(DO.account.action.profileSummary, "markProfileSummaryGenerationDispatched")
      .mockResolvedValue(true);
    vi.mocked(
      DO.account.action.profileSummary.listUndispatchedProfileSummaryGenerationIds,
    ).mockResolvedValue(["generation-1"]);
    vi.spyOn(DO.account.action.diary, "closeExpiredSessions").mockResolvedValue(0);
    vi.spyOn(
      DO.account.action.diagnosisBrainProjection,
      "processPendingDiagnosisBrainProjections",
    ).mockResolvedValue({
      processed: 0,
      applied: 0,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    vi.spyOn(DO.account.action.diary, "claimDueDiaryBrainCheckpointIds").mockResolvedValue({
      checkpointIds: [],
      terminalFailures: [],
    });
    vi.spyOn(DO.account.action.brain, "claimDueBrainVectorSyncJobs").mockResolvedValue({
      jobs: [],
      terminalFailures: [],
    });

    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-1",
      operationTail: Promise.resolve(),
      repository: { client: {}, nextMaintenanceAt: () => null },
      ctx: { storage: { get: vi.fn().mockResolvedValue(false) } },
      env: { PROFILE_SUMMARY_QUEUE: { send } },
    });

    await expect(instance.alarm()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({
      type: "profile-summary-generation",
      accountId: "account-1",
      generationId: "generation-1",
    });
    expect(markDispatched).toHaveBeenCalledWith({}, "account-1", "generation-1");
  });

  it("Queue投入失敗時も永続状態から次のalarmを明示的に設定する", async () => {
    const now = new Date("2026-08-09T00:00:00.000Z").getTime();
    const nextAttemptAt = now + 60_000;
    const setAlarm = vi.fn(async () => undefined);
    const chatTurnSend = vi.fn(async () => undefined);
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(DO.account.action.diary, "closeExpiredSessions").mockResolvedValue(0);
    vi.spyOn(
      DO.account.action.diagnosisBrainProjection,
      "processPendingDiagnosisBrainProjections",
    ).mockResolvedValue({
      processed: 0,
      applied: 0,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    vi.spyOn(DO.account.action.diary, "claimDueDiaryBrainCheckpointIds").mockResolvedValue({
      checkpointIds: ["checkpoint-1"],
      terminalFailures: [],
    });

    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-1",
      operationTail: Promise.resolve(),
      repository: {
        client: {},
        nextMaintenanceAt: () => nextAttemptAt,
      },
      ctx: { storage: { get: vi.fn().mockResolvedValue(false), setAlarm } },
      env: {
        CHAT_TURN_QUEUE: { send: chatTurnSend },
        BRAIN_CHECKPOINT_QUEUE: {
          send: async () => {
            throw new Error("temporary queue outage");
          },
        },
      },
    });

    await expect(instance.alarm()).resolves.toBeUndefined();
    expect(chatTurnSend).not.toHaveBeenCalled();
    expect(setAlarm).toHaveBeenCalledWith(nextAttemptAt);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "alarm.run.failed",
        component: "account-data",
        outcome: "failed",
        disposition: "alarm-retry",
        errorCode: "ACCOUNT_DATA_ALARM_FAILED",
        stage: "alarm.maintenance",
        retryable: true,
      }),
      expect.stringContaining("[AccountData] alarm failed at alarm.maintenance -> alarm-retry"),
    );
  });

  it("Vector同期jobの終端ログにreset対象IDと実際の原因分類を含める", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(DO.account.action.diary, "closeExpiredSessions").mockResolvedValue(0);
    vi.spyOn(
      DO.account.action.diagnosisBrainProjection,
      "processPendingDiagnosisBrainProjections",
    ).mockResolvedValue({
      processed: 0,
      applied: 0,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    vi.spyOn(DO.account.action.diary, "claimDueDiaryBrainCheckpointIds").mockResolvedValue({
      checkpointIds: [],
      terminalFailures: [],
    });
    vi.spyOn(DO.account.action.brain, "claimDueBrainVectorSyncJobs").mockResolvedValue({
      jobs: [],
      terminalFailures: [
        {
          jobId: "job-1",
          brainItemId: "brain-1",
          attemptCount: 6,
          failureCode: "BRAIN_VECTOR_SYNC_ATTEMPTS_EXHAUSTED",
        },
      ],
    });

    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-1",
      operationTail: Promise.resolve(),
      repository: { client: {}, nextMaintenanceAt: () => null },
      ctx: { storage: { get: vi.fn().mockResolvedValue(false) } },
      env: {},
    });

    await expect(instance.alarm()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "brain-vector-sync.job.failed",
        jobId: "job-1",
        brainItemId: "brain-1",
        jobStatus: "failed",
        terminalReason: "attempts-exhausted",
        errorCategory: "unknown",
      }),
      expect.stringContaining("category:unknown"),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("statement");
  });

  it("上限到達したDiary Brain checkpointをID付き構造化ログへ記録する", async () => {
    const checkpointId = "checkpoint-poison";
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(DO.account.action.diary, "closeExpiredSessions").mockResolvedValue(0);
    vi.spyOn(
      DO.account.action.diagnosisBrainProjection,
      "processPendingDiagnosisBrainProjections",
    ).mockResolvedValue({
      processed: 0,
      applied: 0,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
    vi.spyOn(DO.account.action.diary, "claimDueDiaryBrainCheckpointIds").mockResolvedValue({
      checkpointIds: [],
      terminalFailures: [
        {
          checkpointId,
          attemptCount: DO.account.action.diary.DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS,
          failureCode: "DIARY_BRAIN_CHECKPOINT_ATTEMPTS_EXHAUSTED",
        },
      ],
    });
    vi.spyOn(DO.account.action.brain, "claimDueBrainVectorSyncJobs").mockResolvedValue({
      jobs: [],
      terminalFailures: [],
    });

    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-1",
      operationTail: Promise.resolve(),
      repository: { client: {}, nextMaintenanceAt: () => null },
      ctx: { storage: { get: vi.fn().mockResolvedValue(false) } },
      env: {},
    });

    await expect(instance.alarm()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "diary-brain-checkpoint.job.failed",
        checkpointId,
        outcome: "failed",
        disposition: "stop",
        errorCode: "DIARY_BRAIN_CHECKPOINT_ATTEMPTS_EXHAUSTED",
        retryable: false,
      }),
      expect.stringContaining("[Diary Brain checkpoint] failed"),
    );
  });

  it("共有D1が版を公開していない間はcatalog snapshotを最新と見なさない", async () => {
    const isDiagnosisCatalogCurrent = vi.fn(() => true);
    const syncDiagnosisCatalog = vi.fn();
    // `from()`はawaitできて`.where()`も持つdrizzleのbuilderを模す。
    const shared = {
      select: () => ({
        from: () =>
          Object.assign(Promise.resolve([]), {
            where: () => ({ get: async () => undefined }),
          }),
      }),
    };
    vi.spyOn(D1.shared.client, "create").mockReturnValue(shared as never);

    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      repository: { isDiagnosisCatalogCurrent, syncDiagnosisCatalog },
      env: { DB: {} },
    });

    await (instance as unknown as { syncDiagnosisCatalog(): Promise<void> }).syncDiagnosisCatalog();

    // 版が無いのでshort-circuitせず、snapshotを読み直す。
    expect(isDiagnosisCatalogCurrent).not.toHaveBeenCalled();
    expect(syncDiagnosisCatalog).toHaveBeenCalledWith(expect.objectContaining({ version: 0 }));
  });
});
