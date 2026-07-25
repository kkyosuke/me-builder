import { logger } from "@me-builder/shared";
import { registerLineWebhook } from "../src/lib/line-webhook";

logger.info("[Script] Executing LINE Webhook registration...");
registerLineWebhook().then((result) => {
  if (result.success) {
    logger.info("[Script] Registration process completed successfully.");
  } else {
    logger.info(`[Script] Registration process ended with message: ${result.message}`);
  }
});
