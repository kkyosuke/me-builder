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
  // wranglerは応答が空のとき`JSON.stringify(undefined)`をそのまま出力し、JSONにならない。
  const body = stdout.trim();
  if (body === "" || body === "undefined") return null;
  return JSON.parse(body);
}

await runWrangler(
  ["vectorize", "create", indexName, "--dimensions=768", "--metric=cosine"],
  /already exists|already taken|duplicate/i,
  `Vectorize index ${indexName}`,
);
const index = ((await readWranglerJson(["vectorize", "get", indexName])) ?? {}) as {
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

// create-metadata-index はmutationをキューへ積むだけで、list へ現れるまでの時間に保証がない。
// デプロイをその反映待ちで止めないため、ここでは1回だけ確認し、未反映は警告に留める。
// 型違いで既に存在する場合だけは、後続のfilter検索が壊れるためデプロイを止める。
const metadataIndexes = await readWranglerJson(["vectorize", "list-metadata-index", indexName]);
const ownerScope = (Array.isArray(metadataIndexes) ? metadataIndexes : []).find(
  (entry): entry is { propertyName: string; indexType?: string } =>
    typeof entry === "object" &&
    entry !== null &&
    "propertyName" in entry &&
    entry.propertyName === "owner_scope",
);
if (!ownerScope) {
  console.warn(
    `::warning::metadata index ${indexName}.owner_scope is still propagating; vector insert must wait until it becomes visible`,
  );
} else if (ownerScope.indexType !== "string") {
  throw new Error(
    `metadata index ${indexName}.owner_scope must be a string index but is ${ownerScope.indexType}; delete and recreate it before deployment`,
  );
} else {
  console.info(`Verified metadata index ${indexName}.owner_scope`);
}
