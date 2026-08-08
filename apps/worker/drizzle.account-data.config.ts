import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: [
    "./src/account-data/schema.ts",
    "../../packages/lib/src/d1/schema/brain.ts",
    "../../packages/lib/src/d1/schema/conversation.ts",
    "../../packages/lib/src/d1/schema/diagnosis.ts",
    "../../packages/lib/src/d1/schema/source.ts",
  ],
  out: "./drizzle-account-data",
});
