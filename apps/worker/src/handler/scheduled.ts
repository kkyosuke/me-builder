import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Env } from "../types";

export async function scheduledHandler(_controller: ScheduledController, env: Env): Promise<void> {
  const db = d1.client.create(env.DB);
  const closed = await d1.action.conversation.closeExpiredSessions(db);
  const purged = await d1.action.conversation.purgeExpiredConversationBodies(db);
  logger.info({ closed, purged }, "Expired conversation sessions and assistant bodies processed");
}
