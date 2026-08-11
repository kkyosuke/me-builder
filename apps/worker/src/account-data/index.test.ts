import { D1, DO } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountData } from ".";

describe("AccountData alarm", () => {
  afterEach(() => vi.restoreAllMocks());

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
    vi.spyOn(DO.account.action.diary, "claimDueDiaryBrainCheckpointIds").mockResolvedValue([
      "checkpoint-1",
    ]);

    const instance = Object.create(AccountData.prototype) as AccountData;
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountId: "account-1",
      operationTail: Promise.resolve(),
      repository: {
        client: {},
        nextMaintenanceAt: () => nextAttemptAt,
      },
      ctx: { storage: { setAlarm } },
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
