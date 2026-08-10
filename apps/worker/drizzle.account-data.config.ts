import { defineConfig } from "drizzle-kit";

// AccountDataのtable定義はpackages/libが所有するため、migrationも同じ場所へ出力する。
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/account-data/drizzle-schema.ts",
  out: "../../packages/lib/drizzle-account-data",
});
