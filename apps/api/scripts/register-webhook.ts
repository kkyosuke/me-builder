import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { config } from "../src/config";

logger.info("[Script] Executing LINE Webhook registration...");
line.webhook
  .register({
    channelAccessToken: config.lineChannelAccessToken,
    webhookUrl: config.lineWebhookUrl,
  })
  .then((result) => {
    if (result.success) {
      logger.info("[Script] Registration process completed successfully.");
    } else {
      logger.info(`[Script] Registration process ended with message: ${result.message}`);
    }
  });
