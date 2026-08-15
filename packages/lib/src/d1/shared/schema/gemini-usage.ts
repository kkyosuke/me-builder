import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Googleが返した生成レスポンス単位のtoken利用量。本文や本人識別子は保持しない。 */
export const geminiUsageRecords = sqliteTable(
  "gemini_usage_records",
  {
    responseId: text("response_id").primaryKey(),
    accountId: text("account_id").notNull(),
    operation: text("operation", {
      enum: ["diary_chat", "diary_brain", "profile_summary", "weekly_reflection"],
    }).notNull(),
    model: text("model").notNull(),
    promptTokenCount: integer("prompt_token_count").notNull().default(0),
    candidatesTokenCount: integer("candidates_token_count").notNull().default(0),
    thoughtsTokenCount: integer("thoughts_token_count").notNull().default(0),
    cachedContentTokenCount: integer("cached_content_token_count").notNull().default(0),
    toolUsePromptTokenCount: integer("tool_use_prompt_token_count").notNull().default(0),
    totalTokenCount: integer("total_token_count").notNull().default(0),
    generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("gemini_usage_generated_at_idx").on(table.generatedAt),
    index("gemini_usage_account_generated_at_idx").on(table.accountId, table.generatedAt),
  ],
);
