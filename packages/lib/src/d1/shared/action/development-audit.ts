import { lt } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { developmentOperationAudits } from "../schema/development-audit";

export const DEVELOPMENT_OPERATION_AUDIT_RETENTION_DAYS = 90;

export type DevelopmentOperation =
  | "account-data-reset"
  | "brain-vector-single-reset"
  | "brain-vector-bulk-reset";

export async function pruneDevelopmentOperationAudits(
  db: SharedD1Client,
  at = new Date(),
): Promise<number> {
  const expiresBefore = new Date(
    at.getTime() - DEVELOPMENT_OPERATION_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  const deleted = await db
    .delete(developmentOperationAudits)
    .where(lt(developmentOperationAudits.createdAt, expiresBefore))
    .returning({ id: developmentOperationAudits.id })
    .all();
  return deleted.length;
}

/** 最小限の成功記録を保存し、90日の保持境界を同じbatchで適用する。 */
export async function recordDevelopmentOperationAudit(
  db: SharedD1Client,
  operation: DevelopmentOperation,
  affectedCount: number,
  createdAt = new Date(),
): Promise<void> {
  if (!Number.isSafeInteger(affectedCount) || affectedCount < 0) {
    throw new Error("Development operation affected count must be a non-negative integer");
  }
  await db.batch([
    db.insert(developmentOperationAudits).values({
      id: crypto.randomUUID(),
      operation,
      result: "succeeded",
      affectedCount,
      createdAt,
    }),
    db
      .delete(developmentOperationAudits)
      .where(
        lt(
          developmentOperationAudits.createdAt,
          new Date(
            createdAt.getTime() - DEVELOPMENT_OPERATION_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
          ),
        ),
      ),
  ]);
}
