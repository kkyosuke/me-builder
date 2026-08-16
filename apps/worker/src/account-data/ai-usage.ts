import { DO } from "@me-builder/lib";

/** AI上限の予約・確定・解放を1 Accountの直列RPCへ閉じ込める。 */
export const aiUsageActions = {
  "aiUsage.reserve": (
    db: DO.account.Database,
    accountId: string,
    input: Parameters<typeof DO.account.action.aiUsage.reserveAiUsage>[2],
    at?: Date,
  ) => DO.account.action.aiUsage.reserveAiUsage(db, accountId, input, at),
  "aiUsage.commit": (db: DO.account.Database, accountId: string, requestId: string, at?: Date) =>
    DO.account.action.aiUsage.commitAiUsage(db, accountId, requestId, at),
  "aiUsage.release": (db: DO.account.Database, accountId: string, requestId: string, at?: Date) =>
    DO.account.action.aiUsage.releaseAiUsage(db, accountId, requestId, at),
  "aiUsage.read": (
    db: DO.account.Database,
    accountId: string,
    kind: Parameters<typeof DO.account.action.aiUsage.readAiUsage>[2],
    period: Parameters<typeof DO.account.action.aiUsage.readAiUsage>[3],
    limit: number,
    at?: Date,
  ) => DO.account.action.aiUsage.readAiUsage(db, accountId, kind, period, limit, at),
} as const;
