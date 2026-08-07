import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/conversation-coordinator/schema.ts",
  out: "./drizzle",
});
