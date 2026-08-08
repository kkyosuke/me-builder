import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/account-data/drizzle-schema.ts",
  out: "./drizzle/account-data",
});
