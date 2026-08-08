import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/compatibility-data/schema.ts",
  out: "./drizzle/compatibility-data",
});
