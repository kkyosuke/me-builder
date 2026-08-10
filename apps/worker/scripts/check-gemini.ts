import { logger } from "@me-builder/shared";
import { getWorkerConfig } from "../src/config";
import { createGeminiClient, generateText } from "../src/infrastructure/gemini-client";

const config = getWorkerConfig();

if (!config.googleVertexAiApiKey || !config.cloudflareAiGatewayToken) {
  throw new Error("GOOGLE_VERTEX_AI_API_KEY and CLOUDFLARE_APP_API_TOKEN are required");
}

const client = createGeminiClient({
  googleVertexAiApiKey: config.googleVertexAiApiKey,
  cloudflareAiGatewayToken: config.cloudflareAiGatewayToken,
  cloudflareAiGatewayBaseUrl: config.cloudflareAiGatewayBaseUrl,
});
const contents = process.argv.slice(2).join(" ") || "What is Cloudflare?";
const text = await generateText(client, config.geminiModel, contents);
if (!text?.trim()) throw new Error("Gemini connectivity check returned no text");

logger.info(
  { model: config.geminiModel, outputLength: text.length },
  "Gemini connectivity check completed",
);
