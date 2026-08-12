import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { app } from "./app";
import { config } from "./config";
import { logLineStartupConfiguration } from "./startup-configuration";

logLineStartupConfiguration(config);

// 起動時の LINE Webhook 自動登録処理
if (typeof process !== "undefined" && process.env && config.lineChannelAccessToken) {
  line.webhook.register({
    channelAccessToken: config.lineChannelAccessToken,
    webhookUrl: config.lineWebhookUrl,
  });
}

logger.info(`API Server is running on http://localhost:${config.port}`);

export { app };
export default {
  port: config.port,
  fetch: app.fetch,
};
