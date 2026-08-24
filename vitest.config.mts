import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "sql-as-text",
      transform(source, id) {
        if (id.endsWith(".sql")) return `export default ${JSON.stringify(source)}`;
      },
    },
  ],
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./apps/worker/src/testing/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Node 24+ の実験的Web Storageは保存先未指定だとundefinedになり、
    // jsdomのwindow.localStorageを上書きするため、test workerでは無効化する。
    execArgv: ["--no-experimental-webstorage"],
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/worker/src/runtime-e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "apps/api/src/logic/authentication/**/*.ts",
        "apps/api/src/infrastructure/authentication/**/*.ts",
        "apps/api/src/controller/authentication.ts",
        "apps/api/src/controller/sso-identity.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.e2e.test.ts", "**/testing/**"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 90,
        lines: 80,
      },
    },
  },
});
