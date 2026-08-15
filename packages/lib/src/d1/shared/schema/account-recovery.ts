import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./account";

export const accountRecoveryCredentials = sqliteTable(
  "account_recovery_credentials",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    secretHash: text("secret_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    claimedIdentityHash: text("claimed_identity_hash"),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    usedAt: integer("used_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("account_recovery_account_idx").on(table.accountId, table.createdAt)],
);

export const accountRecoveryRateLimits = sqliteTable(
  "account_recovery_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    windowStartedAt: integer("window_started_at", { mode: "timestamp" }).notNull(),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("account_recovery_locked_until_idx").on(table.lockedUntil)],
);

export const accountRecoveryAudits = sqliteTable(
  "account_recovery_audits",
  {
    operationId: text("operation_id").primaryKey(),
    accountId: text("account_id").references(() => accounts.id),
    action: text("action", { enum: ["issue", "complete"] }).notNull(),
    outcome: text("outcome", { enum: ["succeeded", "rejected"] }).notNull(),
    reason: text("reason"),
    identityFingerprint: text("identity_fingerprint"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("account_recovery_audit_account_idx").on(table.accountId, table.createdAt)],
);
