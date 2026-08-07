import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          LINE_CHANNEL_ACCESS_TOKEN: "runtime-test-token",
          CHAT_DELIVERY_SECRET: "runtime-test-delivery-secret",
        },
      },
    }),
  ],
  test: {
    include: ["src/runtime-e2e/**/*.test.ts"],
  },
});
