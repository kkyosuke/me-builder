import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function read(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

function expectOrdered(document: string, markers: string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const position = document.indexOf(marker);
    expect(position, `missing release safety marker: ${marker}`).toBeGreaterThan(previous);
    previous = position;
  }
}

describe("release safety contract", () => {
  it("Productionは検証・追加的migration・コード・疎通確認の順で前進deployする", async () => {
    const workflow = await read(".github/workflows/cd-production.yml");
    expectOrdered(workflow, [
      "Validate Production Configuration",
      "Run CI Verification",
      "Ensure Queues (Production)",
      "Ensure Brain Vectorize Index (Production)",
      "Ensure Private Avatar R2 Bucket (Production)",
      "Ensure Application Session KV (Production)",
      "Apply D1 Migrations (Production)",
      "Apply Diagnosis Seed (Production)",
      "Deploy to Cloudflare Production",
      "Verify Service Site Metadata and Search Boundaries (Production)",
      "Verify API Documentation Access (Production)",
      "Verify Application Session Boundary (Production)",
    ]);
  });

  it("Preview全消去は環境とbranchを特定した確認・理由・非cancelを要求する", async () => {
    const workflow = await read(".github/workflows/reset-preview-migrations.yml");
    expect(workflow).toContain("reason:");
    expect(workflow).toContain("reset-preview:${RESET_REF}");
    expect(workflow).toContain("environment: dev");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('echo "- Actor: \\`${RESET_ACTOR}\\`"');
    expectOrdered(workflow, [
      "Validate Branch, Confirmation, and Reason",
      "Record Authorized Reset",
      "Recreate Preview Foundation with Pulumi",
      "Apply Current Branch D1 Migrations and Seed",
      "Redeploy Preview Worker, API, and MCP",
      "Verify Restored Preview Connections",
    ]);
  });

  it("Productionの全消去taskを提供しない", async () => {
    const taskfile = await read("Taskfile.yml");
    expect(taskfile).not.toMatch(/infra:production:(?:destroy|clean|reset):/);
  });
});
