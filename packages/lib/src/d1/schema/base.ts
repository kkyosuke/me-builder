import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Common base schema columns for D1 database tables.
 */
export const baseSchema = {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
};
