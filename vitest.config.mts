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
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/worker/src/runtime-e2e/**"],
  },
});
