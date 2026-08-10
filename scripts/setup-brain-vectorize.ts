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

await runWrangler(
  ["vectorize", "create", indexName, "--dimensions=768", "--metric=cosine"],
  /already exists|already taken|duplicate/i,
  `Vectorize index ${indexName}`,
);
await runWrangler(
  ["vectorize", "create-metadata-index", indexName, "--propertyName=owner_scope", "--type=string"],
  /already exists|already indexed|duplicate/i,
  `metadata index ${indexName}.owner_scope`,
);
