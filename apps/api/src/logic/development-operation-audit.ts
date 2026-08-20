import type { D1Database } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";

export async function recordDevelopmentOperationAudit(
  d1: D1Database,
  operation: Parameters<
    typeof D1.shared.action.developmentAudit.recordDevelopmentOperationAudit
  >[1],
  affectedCount: number,
): Promise<void> {
  try {
    await D1.shared.action.developmentAudit.recordDevelopmentOperationAudit(
      D1.shared.client.create(d1),
      operation,
      affectedCount,
    );
  } catch (error) {
    logger.error(
      {
        event: "development.operation-audit.write.failed",
        service: "api",
        component: "development-operation-audit",
        operation,
        outcome: "failed",
        disposition: "continue-after-operation",
        ...toSafeOperationalErrorFields(error, {
          code: "DEVELOPMENT_OPERATION_AUDIT_WRITE_FAILED",
          category: "dependency",
          stage: "development.operation-audit.write",
          retryable: false,
        }),
      },
      "[Development operation audit] failed after operation completion",
    );
  }
}
