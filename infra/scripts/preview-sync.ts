import { resolve } from "node:path";
import { discoverPreviewInfrastructure } from "../src/cloudflare";
import { requireCloudflareEnvironment, run } from "../src/process";

requireCloudflareEnvironment();
const manifest = await discoverPreviewInfrastructure();
await Bun.write(
  resolve(import.meta.dir, "../environments/preview.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await run(["bun", "scripts/generate-wrangler.ts"]);
