import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseManifest } from "./manifest";
import { run } from "./process";

const infraRoot = resolve(import.meta.dir, "..");
const pulumi = process.env.PULUMI_COMMAND || "pulumi";
const backend = process.env.PULUMI_BACKEND_URL || `file://${resolve(infraRoot, ".pulumi-state")}`;

async function selectPreviewStack() {
  if (!process.env.PULUMI_BACKEND_URL) {
    await mkdir(resolve(infraRoot, ".pulumi-state"), { recursive: true });
  }
  await run([pulumi, "login", backend]);
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
