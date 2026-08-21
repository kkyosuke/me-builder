import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accounts } from "./account";

/** 重要改定のLINE告知をAccount・versionごとに一度だけ配送するための運用記録。 */
export const accountTermsNotifications = sqliteTable(
  "account_terms_notifications",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    documentVersion: text("document_version").notNull(),
    channel: text("channel", { enum: ["line"] }).notNull(),
    disposition: text("disposition", { enum: ["delivered", "rejected"] }).notNull(),
    deliveredAt: text("delivered_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_terms_notification_once_idx").on(
      table.accountId,
      table.documentVersion,
      table.channel,
    ),
    index("account_terms_notification_version_idx").on(
      table.documentVersion,
      table.channel,
      table.accountId,
    ),
  ],
);
