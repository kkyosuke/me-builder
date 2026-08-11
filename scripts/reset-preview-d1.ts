const LIST_SCHEMA_SQL = `
SELECT 'table' AS kind, name, NULL AS parent
FROM sqlite_schema
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
UNION ALL
SELECT 'foreign-key' AS kind, schema.name, foreign_key."table" AS parent
FROM sqlite_schema AS schema, pragma_foreign_key_list(schema.name) AS foreign_key
WHERE schema.type = 'table'
  AND schema.name NOT LIKE 'sqlite_%'
  AND schema.name NOT LIKE '_cf_%'
ORDER BY kind DESC, name;
`.trim();

type D1ExecuteResult = {
  results?: Array<{ kind?: unknown; name?: unknown; parent?: unknown }>;
  success?: boolean;
};

type ForeignKey = { child: string; parent: string };

export function parseSchema(output: string): {
  tableNames: string[];
  foreignKeys: ForeignKey[];
} {
  const payload: unknown = JSON.parse(output);
  if (!Array.isArray(payload)) throw new Error("Unexpected Wrangler D1 JSON response");

  const executions = payload as D1ExecuteResult[];
  if (executions.some((execution) => execution.success === false)) {
    throw new Error("Wrangler failed to list D1 tables");
  }

  const tableNames: string[] = [];
  const foreignKeys: ForeignKey[] = [];
  for (const { kind, name, parent } of executions.flatMap(({ results }) => results ?? [])) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("D1 returned an invalid table name");
    }
    if (kind === "table") {
      tableNames.push(name);
    } else if (kind === "foreign-key" && typeof parent === "string" && parent.length > 0) {
      foreignKeys.push({ child: name, parent });
    } else {
      throw new Error("D1 returned an invalid schema row");
    }
  }
  return { tableNames, foreignKeys };
}

export function sortTablesForDrop(tableNames: string[], foreignKeys: ForeignKey[]): string[] {
  const uniqueNames = [...new Set(tableNames)];
  const knownNames = new Set(uniqueNames);
  const parentsByChild = new Map(uniqueNames.map((name) => [name, new Set<string>()]));
  const incomingEdges = new Map(uniqueNames.map((name) => [name, 0]));

  for (const { child, parent } of foreignKeys) {
    if (child === parent || !knownNames.has(child) || !knownNames.has(parent)) continue;
    const parents = parentsByChild.get(child);
    if (!parents || parents.has(parent)) continue;
    parents.add(parent);
    incomingEdges.set(parent, (incomingEdges.get(parent) ?? 0) + 1);
  }

  const ready = uniqueNames.filter((name) => incomingEdges.get(name) === 0).sort();
  const sorted: string[] = [];
  while (ready.length > 0) {
    const child = ready.shift();
    if (!child) break;
    sorted.push(child);
    for (const parent of parentsByChild.get(child) ?? []) {
      const remaining = (incomingEdges.get(parent) ?? 0) - 1;
      incomingEdges.set(parent, remaining);
      if (remaining === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }

  if (sorted.length !== uniqueNames.length) {
    throw new Error("D1 schema contains cyclic foreign keys; refusing a partial reset");
  }
  return sorted;
}

export function buildDropTablesSql(tableNames: string[], foreignKeys: ForeignKey[]): string {
  const statements = sortTablesForDrop(tableNames, foreignKeys).map(
    (name) => `DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}";`,
  );
  return statements.join("\n");
}

async function runWrangler(args: string[]): Promise<string> {
  const child = Bun.spawn(["bun", "--cwd", "packages/lib", "wrangler", ...args], {
    env: { ...process.env, WRANGLER_LOG: "none" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim());
  return stdout;
}

async function main() {
  const output = await runWrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    "preview",
    "--remote",
    "--command",
    LIST_SCHEMA_SQL,
    "--json",
  ]);
  const { tableNames, foreignKeys } = parseSchema(output);

  if (tableNames.length === 0) {
    console.info("Preview D1 has no user or migration tables to reset.");
    return;
  }

  await runWrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    "preview",
    "--remote",
    "--command",
    buildDropTablesSql(tableNames, foreignKeys),
    "--yes",
  ]);
  console.info(`Dropped ${tableNames.length} Preview D1 tables, including migration history.`);
}

if (import.meta.main) {
  await main();
}
