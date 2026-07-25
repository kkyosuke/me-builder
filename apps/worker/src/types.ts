import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  ENVIRONMENT?: string;
  BASE_DOMAIN?: string;
  BASE_URL?: string;
  API_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  DB: D1Database;
}
