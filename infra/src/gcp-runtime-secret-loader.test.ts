import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const loader = new URL(
  "../../.github/actions/load-gcp-runtime-secrets/load-secret.sh",
  import.meta.url,
).pathname;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function execute(mode: string, fallback = "") {
  const directory = await mkdtemp(join(tmpdir(), "me-builder-secret-loader-"));
  temporaryDirectories.push(directory);
  const bin = join(directory, "bin");
  await mkdir(bin);
  const fakeGcloud = join(bin, "gcloud");
  await writeFile(
    fakeGcloud,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" versions list "* ]]; then
  case "\${FAKE_GCLOUD_MODE}" in
    list-error) exit 7 ;;
    no-version) exit 0 ;;
    *) printf 'versions/5\\n' ;;
  esac
fi
if [[ " $* " == *" versions access "* ]]; then
  if [ "\${4:-}" != "5" ]; then exit 9; fi
  if [ "\${FAKE_GCLOUD_MODE}" = access-error ]; then exit 8; fi
  printf 'active-secret'
fi
`,
  );
  await chmod(fakeGcloud, 0o755);
  const githubEnv = join(directory, "github-env");
  await writeFile(githubEnv, "");
  const child = spawn(loader, ["TEST_SECRET", "test-secret", fallback], {
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_GCLOUD_MODE: mode,
      GCP_RUNTIME_PROJECT_ID: "test-project",
      GITHUB_ENV: githubEnv,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  return { exitCode, output: `${stdout}${stderr}`, githubEnv: await readFile(githubEnv, "utf8") };
}

describe("GCP runtime secret loader", () => {
  it("有効なversionが0件と確認できた場合だけfallbackを使う", async () => {
    const result = await execute("no-version", "legacy-secret");

    expect(result.exitCode).toBe(0);
    expect(result.githubEnv).toBe("TEST_SECRET=legacy-secret\n");
    expect(result.output).toContain("移行期間中");
  });

  it.each(["list-error", "access-error"])("%sではfallbackせず失敗する", async (mode) => {
    const result = await execute(mode, "legacy-secret");

    expect(result.exitCode).not.toBe(0);
    expect(result.githubEnv).toBe("");
  });

  it("有効なversionを固定して読み込む", async () => {
    const result = await execute("success", "legacy-secret");

    expect(result.exitCode).toBe(0);
    expect(result.githubEnv).toBe("TEST_SECRET=active-secret\n");
    expect(result.output).not.toContain("移行期間中");
  });
});
