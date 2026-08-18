import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * SSO callback transaction consume claim.
 *
 * OAuth state自体やtransaction payloadは持たず、同じstateのcallbackを1件に絞る。
 */
export const ssoAuthenticationTransactionClaims = sqliteTable(
  "sso_authentication_transaction_claims",
  {
    stateHash: text("state_hash").primaryKey(),
    expiresAt: integer("expires_at").notNull(),
  },
);
