import type { D1Database } from "@cloudflare/workers-types";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * 共有D1のclient型。
 *
 * 共有D1はAccount Identity、全Account共通の公開定義、原文を含まない集計projectionだけを
 * 保持する。Account所有データを扱うactionはこの型を受け取らない。
 */
export type SharedD1Client = DrizzleD1Database<typeof schema>;

export function createSharedD1Client(d1: D1Database): SharedD1Client {
  return drizzle(d1, { schema });
}
