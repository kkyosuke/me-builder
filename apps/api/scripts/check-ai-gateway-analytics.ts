import { logger } from "@me-builder/shared";
import { getConfig } from "../src/config";
import { fetchAiGatewayUsage } from "../src/infrastructure/cloudflare-ai-gateway-analytics";

const config = getConfig();

if (!config.cloudflareAccountId || !config.cloudflareAppApiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_APP_API_TOKEN are required");
}

const end = new Date();
const start = new Date(end.getTime() - 60 * 60 * 1000);
const usage = await fetchAiGatewayUsage({
  apiToken: config.cloudflareAppApiToken,
  accountId: config.cloudflareAccountId,
  gatewayId: config.cloudflareAiGatewayId,
  start,
  end,
});

logger.info(
  { gatewayId: config.cloudflareAiGatewayId, requestCount: usage.requestCount },
  "AI Gateway Analytics connectivity check completed",
);
