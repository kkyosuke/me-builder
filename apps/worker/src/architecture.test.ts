import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(absolute)
        : Promise.resolve(entry.name.endsWith(".ts") ? [absolute] : []);
    }),
  );
  return nested.flat();
}

describe("worker architecture", () => {
  it("logic層からhandler層へ依存しない", async () => {
    const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
    const logicDirectory = path.resolve(sourceDirectory, "logic");
    const violations: string[] = [];

    for (const file of await sourceFiles(logicDirectory)) {
      const source = await readFile(file, "utf8");
      if (/from\s+["'][^"']*handler\//u.test(source)) {
        violations.push(path.relative(sourceDirectory, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
