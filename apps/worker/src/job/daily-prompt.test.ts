import { D1 } from "@me-builder/lib";
import type { DailyPromptQueueMessage, Queue } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueDailyPrompts, toTokyoLocalDate } from "./daily-prompt";

describe("daily prompt scheduler job", () => {
  afterEach(() => vi.restoreAllMocks());

  it("09:00 UTCを同日のAsia/Tokyo日付へ変換する", () => {
    expect(toTokyoLocalDate(new Date("2026-08-14T09:00:00.000Z").getTime())).toBe("2026-08-14");
    expect(toTokyoLocalDate(new Date("2026-08-14T15:30:00.000Z").getTime())).toBe("2026-08-15");
  });

  it("activeなAccountを100件ずつ本文なしでQueueへ投入する", async () => {
    const firstPage = Array.from(
      { length: 100 },
      (_, index) => `account-${index.toString().padStart(3, "0")}`,
    );
    const list = vi
      .spyOn(D1.shared.action.account, "listActiveLineAccountIds")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(["account-100"]);
    const sendBatch = vi.fn().mockResolvedValue(undefined);

    await expect(
      enqueueDailyPrompts({
        db: {} as D1.shared.Client,
        queue: { sendBatch } as unknown as Queue<DailyPromptQueueMessage>,
        scheduledTime: new Date("2026-08-14T09:00:00.000Z").getTime(),
      }),
    ).resolves.toBe(101);

    expect(list).toHaveBeenNthCalledWith(2, expect.anything(), {
      afterAccountId: "account-099",
      limit: 100,
    });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(sendBatch.mock.calls[1]?.[0]).toEqual([
      {
        body: { type: "daily-prompt", accountId: "account-100", localDate: "2026-08-14" },
      },
    ]);
  });
});
