import { logger } from "@me-builder/shared";
import type { Env } from "../types";

export async function scheduledHandler(_controller: ScheduledController, _env: Env): Promise<void> {
  // Account所有maintenanceは各AccountData Objectのalarmが処理する。
  logger.info("Shared D1 scheduled maintenance completed");
}
