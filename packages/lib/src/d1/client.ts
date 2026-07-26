import type { D1Database } from "@cloudflare/workers-types";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type D1Client = DrizzleD1Database<typeof schema>;

/**
 * Creates a Drizzle client instance for Cloudflare D1.
 *
 * @param d1 Cloudflare D1Database binding instance
 * @returns Drizzle D1 Client
 */
export function createD1Client(d1: D1Database): D1Client {
  return drizzle(d1, { schema });
}
