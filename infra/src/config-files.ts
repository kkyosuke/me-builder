import { resolve } from "node:path";
import { parseManifest } from "./manifest";
import { renderWranglerConfigs } from "./wrangler";

export const root = resolve(import.meta.dir, "../..");
export const configPaths = {
  worker: resolve(root, "apps/worker/wrangler.toml"),
  api: resolve(root, "apps/api/wrangler.toml"),
  mcp: resolve(root, "apps/mcp/wrangler.toml"),
  lib: resolve(root, "packages/lib/wrangler.toml"),
} as const;

async function readManifest(environment: "preview" | "production") {
  return parseManifest(
    await Bun.file(resolve(root, `infra/environments/${environment}.json`)).json(),
  );
}

export async function expectedWranglerConfigs() {
  return renderWranglerConfigs(await readManifest("preview"), await readManifest("production"));
}
