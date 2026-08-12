import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateLiffConfigurationForBuild } from "./validate-liff-configuration";

describe("validateLiffConfigurationForBuild", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("Viteがproduction buildで読み込むenvファイルの不正値を拒否する", async () => {
    vi.stubEnv("VITE_LIFF_ID", undefined);
    vi.stubEnv("LIFF_ID", undefined);
    vi.stubEnv("LINE_LOGIN_CHANNEL_ID", undefined);
    const envDir = await mkdtemp(join(tmpdir(), "me-builder-liff-validation-"));
    try {
      await writeFile(join(envDir, ".env.production"), "VITE_LIFF_ID=invalid\n");
      expect(() => validateLiffConfigurationForBuild(envDir)).toThrow("LIFF_ID");
    } finally {
      await rm(envDir, { recursive: true });
    }
  });
});
