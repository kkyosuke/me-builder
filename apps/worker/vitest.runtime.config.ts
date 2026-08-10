import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const sharedD1Migrations = await readD1Migrations(
  fileURLToPath(new URL("../../packages/lib/drizzle", import.meta.url)),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          ENVIRONMENT: "preview",
          LINE_CHANNEL_ACCESS_TOKEN: "runtime-test-token",
          CHAT_DELIVERY_SECRET: "runtime-test-delivery-secret",
          PREVIEW_RESET_TOKEN: "runtime-reset-token",
          TEST_D1_MIGRATIONS: sharedD1Migrations,
        },
      },
    }),
  ],
  test: {
    include: ["src/runtime-e2e/**/*.test.ts"],
  },
});
