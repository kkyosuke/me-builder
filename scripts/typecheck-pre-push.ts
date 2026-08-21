type Workspace = {
  name: string;
  directory: string;
  dependencies: string[];
};

const workspaces: Workspace[] = [
  { name: "@me-builder/shared", directory: "packages/shared", dependencies: [] },
  {
    name: "@me-builder/lib",
    directory: "packages/lib",
    dependencies: ["@me-builder/shared"],
  },
  {
    name: "@me-builder/api",
    directory: "apps/api",
    dependencies: ["@me-builder/lib", "@me-builder/shared"],
  },
  {
    name: "@me-builder/mcp",
    directory: "apps/mcp",
    dependencies: ["@me-builder/shared"],
  },
  {
    name: "@me-builder/web",
    directory: "apps/web",
    dependencies: ["@me-builder/lib", "@me-builder/shared"],
  },
  {
    name: "@me-builder/worker",
    directory: "apps/worker",
    dependencies: ["@me-builder/lib", "@me-builder/shared"],
  },
  { name: "@me-builder/infra", directory: "infra", dependencies: [] },
];

export function affectedWorkspaceNames(files: string[]): string[] {
  const affected = new Set(
    workspaces
      .filter(({ directory }) =>
        files.some((file) => {
          const normalizedFile = file.replace(/^\.\//, "");
          return normalizedFile === directory || normalizedFile.startsWith(`${directory}/`);
        }),
      )
      .map(({ name }) => name),
  );

  let addedDependent = true;
  while (addedDependent) {
    addedDependent = false;
    for (const workspace of workspaces) {
      if (
        !affected.has(workspace.name) &&
        workspace.dependencies.some((dependency) => affected.has(dependency))
      ) {
        affected.add(workspace.name);
        addedDependent = true;
      }
    }
  }

  return workspaces.map(({ name }) => name).filter((name) => affected.has(name));
}

async function main(files: string[]): Promise<void> {
  const affectedNames = affectedWorkspaceNames(files);
  if (affectedNames.length === 0) {
    console.log("No workspace typecheck is required for the pushed files");
    return;
  }

  const filters = affectedNames.flatMap((name) => ["--filter", name]);
  const processResult = Bun.spawn(["bun", ...filters, "typecheck"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await processResult.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

if (import.meta.main) await main(process.argv.slice(2));
