import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  CLOUDFLARE_AIG_TOKEN?: string;
  CF_AI_GATEWAY_BASE_URL?: string;
  GEMINI_MODEL?: string;
  DB: D1Database;
}
