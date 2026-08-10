import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/shared-d1/schema/index.ts",
  out: "./drizzle",
});
