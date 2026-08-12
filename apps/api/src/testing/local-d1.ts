import type { D1Database } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";

/** サービス境界をまたぐE2E向けに、隔離されたlocal D1と終了処理をまとめて返す。 */
export async function createLocalD1(databaseName: string): Promise<{
  database: D1Database;
  dispose(): Promise<void>;
}> {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-29",
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: databaseName },
  });
  return {
    database: (await miniflare.getD1Database("DB")) as D1Database,
    dispose: () => miniflare.dispose(),
  };
}
