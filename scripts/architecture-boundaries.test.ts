import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|e2e\.test)\./.test(entry.name)
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

function moduleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
}

describe("architecture boundaries", () => {
  it("Worker logicからhandlerへ逆依存しない", async () => {
    const logicRoot = resolve(repositoryRoot, "apps/worker/src/logic");
    const violations: string[] = [];
    for (const file of await sourceFiles(logicRoot)) {
      const source = await readFile(file, "utf8");
      for (const specifier of moduleSpecifiers(source).filter((value) => value.startsWith("."))) {
        const target = resolve(dirname(file), specifier);
        if (target.includes(`${sep}apps${sep}worker${sep}src${sep}handler${sep}`)) {
          violations.push(`${relative(repositoryRoot, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("Web feature外から内部layerを直接参照しない", async () => {
    const sourceRoot = resolve(repositoryRoot, "apps/web/src");
    const featureRoot = resolve(sourceRoot, "feature");
    const violations: string[] = [];
    for (const file of await sourceFiles(sourceRoot)) {
      const importerFeature = relative(featureRoot, file).split(sep)[0];
      for (const specifier of moduleSpecifiers(await readFile(file, "utf8")).filter((value) =>
        value.startsWith("."),
      )) {
        const targetParts = relative(featureRoot, resolve(dirname(file), specifier)).split(sep);
        const [targetFeature, targetLayer] = targetParts;
        if (
          targetFeature &&
          targetFeature !== ".." &&
          importerFeature === ".." &&
          ["model", "presentation", "infrastructure"].includes(targetLayer ?? "")
        ) {
          violations.push(`${relative(repositoryRoot, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("MCP controllerをHTTP変換境界に保つ", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "apps/api/src/controller/mcp.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/D1\.shared\.action|createOpaqueCredential|hmacSha256Hex/);
    expect(source).toContain('from "../logic/mcp-service"');
  });
});
