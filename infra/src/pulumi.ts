import { resolve } from "node:path";
import { parseManifest } from "./manifest";
import { run } from "./process";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "./pulumi-backend";

const infraRoot = resolve(import.meta.dir, "..");
const pulumi = process.env.PULUMI_COMMAND || "pulumi";

async function selectPreviewStack() {
  const backendUrl = requirePulumiGcsBackend(process.env, pulumiGcsBackends.cloudflare);
  await run([pulumi, "login", backendUrl]);
  try {
    await run([pulumi, "stack", "select", "preview", "--non-interactive"]);
  } catch {
    await run([pulumi, "stack", "init", "preview", "--non-interactive"]);
  }
}

export async function updatePreview() {
  await selectPreviewStack();
  await run([pulumi, "up", "--yes", "--non-interactive"]);
  const output = await run([pulumi, "stack", "output", "infrastructure", "--json"], {
    stdout: "pipe",
  });
  const manifest = parseManifest(JSON.parse(output));
  await Bun.write(
    resolve(infraRoot, "environments/preview.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await run(["bun", "scripts/generate-wrangler.ts"]);
}

export async function destroyPreview() {
  await selectPreviewStack();
  await run([pulumi, "destroy", "--yes", "--non-interactive"]);
}
