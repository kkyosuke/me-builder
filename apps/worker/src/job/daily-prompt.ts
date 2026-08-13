import { D1 } from "@me-builder/lib";
import type { DailyPromptQueueMessage, Queue } from "@me-builder/shared";

const ACCOUNT_PAGE_SIZE = 100;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Cloudflare CronのUTC時刻を、DSTのないAsia/Tokyoの日付へ固定する。 */
export function toTokyoLocalDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("Scheduled timestamp is invalid");
  return new Date(timestamp + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Cron内ではPushせず、activeなAccountを1件ずつ専用Queueへ分割する。 */
export async function enqueueDailyPrompts(
  input: Readonly<{
    db: D1.shared.Client;
    queue: Queue<DailyPromptQueueMessage>;
    scheduledTime: number;
  }>,
): Promise<number> {
  const localDate = toTokyoLocalDate(input.scheduledTime);
  let afterAccountId: string | undefined;
  let enqueued = 0;

  while (true) {
    const accountIds = await D1.shared.action.account.listActiveLineAccountIds(input.db, {
      ...(afterAccountId ? { afterAccountId } : {}),
      limit: ACCOUNT_PAGE_SIZE,
    });
    if (accountIds.length === 0) return enqueued;
    await input.queue.sendBatch(
      accountIds.map((accountId) => ({
        body: { type: "daily-prompt" as const, accountId, localDate },
      })),
    );
    enqueued += accountIds.length;
    afterAccountId = accountIds.at(-1);
    if (accountIds.length < ACCOUNT_PAGE_SIZE) return enqueued;
  }
}
