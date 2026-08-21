import { describe, expect, it } from "vitest";
import { affectedWorkspaceNames } from "./typecheck-pre-push";

describe("affectedWorkspaceNames", () => {
  it("アプリだけの変更ではそのworkspaceだけを返す", () => {
    expect(affectedWorkspaceNames(["apps/web/src/main.tsx"])).toEqual(["@me-builder/web"]);
  });

  it("共通ライブラリの変更では依存するアプリも返す", () => {
    expect(affectedWorkspaceNames(["packages/lib/src/index.ts"])).toEqual([
      "@me-builder/lib",
      "@me-builder/api",
      "@me-builder/web",
      "@me-builder/worker",
    ]);
  });

  it("sharedの変更では推移的な依存先も返す", () => {
    expect(affectedWorkspaceNames(["./packages/shared/src/index.ts"])).toEqual([
      "@me-builder/shared",
      "@me-builder/lib",
      "@me-builder/api",
      "@me-builder/mcp",
      "@me-builder/web",
      "@me-builder/worker",
    ]);
  });

  it("workspace外のファイルは対象にしない", () => {
    expect(affectedWorkspaceNames(["scripts/example.ts", "vitest.config.ts"])).toEqual([]);
  });

  it("複数workspaceの重複を除いて定義順で返す", () => {
    expect(
      affectedWorkspaceNames(["apps/api/src/index.ts", "infra/scripts/generate-wrangler.ts"]),
    ).toEqual(["@me-builder/api", "@me-builder/infra"]);
  });
});
