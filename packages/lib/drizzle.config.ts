import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/d1/shared/schema/index.ts",
  out: "./drizzle",
});
