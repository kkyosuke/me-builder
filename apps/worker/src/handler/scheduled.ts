import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { getCloudflareBindings } from "../config";
import type { Env } from "../types";

export async function scheduledHandler(_controller: ScheduledController, env: Env): Promise<void> {
  const cf = getCloudflareBindings(env);
  const [closed, diagnosisBrainProjections] = await Promise.all([
    d1.action.conversation.closeExpiredSessions(cf.d1),
    d1.action.diagnosisBrainProjection.processPendingDiagnosisBrainProjections(cf.d1),
  ]);
  logger.info({ closed, diagnosisBrainProjections }, "Scheduled D1 maintenance processed");
}
