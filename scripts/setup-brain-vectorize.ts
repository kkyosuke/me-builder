const environment = process.argv[2];
if (environment !== "preview" && environment !== "production") {
  throw new Error("Usage: bun scripts/setup-brain-vectorize.ts <preview|production>");
}

const indexName = `me-builder-brain-${environment}`;

async function runWrangler(args: string[], existsPattern: RegExp, label: string) {
  const child = Bun.spawn(["bun", "--cwd", "apps/worker", "wrangler", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0 && !existsPattern.test(output)) {
    throw new Error(`Failed to create ${label}: ${output.trim()}`);
  }
  console.info(exitCode === 0 ? `Created ${label}` : `${label} already exists`);
}

async function readWranglerJson(args: string[]): Promise<unknown> {
  const child = Bun.spawn(["bun", "--cwd", "apps/worker", "wrangler", ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`Failed to inspect Vectorize: ${stderr.trim()}`);
  return JSON.parse(stdout);
}

await runWrangler(
  ["vectorize", "create", indexName, "--dimensions=768", "--metric=cosine"],
  /already exists|already taken|duplicate/i,
  `Vectorize index ${indexName}`,
);
const index = (await readWranglerJson(["vectorize", "get", indexName])) as {
  config?: { dimensions?: number; metric?: string };
};
if (index.config?.dimensions !== 768 || index.config.metric !== "cosine") {
  throw new Error(
    `Vectorize index ${indexName} must use 768 dimensions and cosine metric; recreate it before deployment`,
  );
}
await runWrangler(
  ["vectorize", "create-metadata-index", indexName, "--propertyName=owner_scope", "--type=string"],
  /already exists|already indexed|duplicate/i,
  `metadata index ${indexName}.owner_scope`,
);
let metadataIndexes: unknown = [];
for (let attempt = 0; attempt < 30; attempt += 1) {
  metadataIndexes = await readWranglerJson(["vectorize", "list-metadata-index", indexName]);
  if (
    Array.isArray(metadataIndexes) &&
    metadataIndexes.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "propertyName" in entry &&
        entry.propertyName === "owner_scope" &&
        "indexType" in entry &&
        entry.indexType === "string",
    )
  ) {
    console.info(`Verified metadata index ${indexName}.owner_scope`);
    process.exit(0);
  }
  await Bun.sleep(2_000);
}
throw new Error(`metadata index ${indexName}.owner_scope was not created as a string index`);
