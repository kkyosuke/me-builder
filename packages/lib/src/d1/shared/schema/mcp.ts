import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accounts } from "./account";

/** 管理者本人が明示的に許可した外部MCP clientとの接続。 */
export const mcpConnections = sqliteTable(
  "mcp_connections",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    metadataHash: text("metadata_hash").notNull(),
    scope: text("scope").notNull(),
    accessProfile: text("access_profile").notNull(),
    status: text("status", { enum: ["active", "revoked"] }).notNull(),
    authorizedAt: integer("authorized_at", { mode: "timestamp" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("mcp_connection_active_client_idx").on(table.accountId, table.clientId),
    index("mcp_connection_account_idx").on(table.accountId, table.status, table.updatedAt),
  ],
);

/** OAuth認可画面へ渡す、短命かつ1回限りの同意transaction。 */
export const mcpAuthorizationRequests = sqliteTable(
  "mcp_authorization_requests",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    metadataHash: text("metadata_hash").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    state: text("state"),
    codeChallenge: text("code_challenge").notNull(),
    resource: text("resource").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
  },
  (table) => [index("mcp_authorization_request_expiry_idx").on(table.expiresAt, table.consumedAt)],
);

/** OAuth authorization code。生値は保存せずhashだけを保持する。 */
export const mcpAuthorizationCodes = sqliteTable(
  "mcp_authorization_codes",
  {
    ...baseSchema,
    connectionId: text("connection_id")
      .notNull()
      .references(() => mcpConnections.id),
    codeHash: text("code_hash").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    resource: text("resource").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
  },
  (table) => [uniqueIndex("mcp_authorization_code_hash_idx").on(table.codeHash)],
);

/** access/refresh token。生値は応答時だけ存在し、D1にはHMACだけを保存する。 */
export const mcpTokens = sqliteTable(
  "mcp_tokens",
  {
    ...baseSchema,
    connectionId: text("connection_id")
      .notNull()
      .references(() => mcpConnections.id),
    familyId: text("family_id").notNull(),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    idleExpiresAt: integer("idle_expires_at", { mode: "timestamp" }),
    usedAt: integer("used_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("mcp_token_hash_idx").on(table.tokenHash),
    index("mcp_token_connection_idx").on(table.connectionId, table.kind, table.revokedAt),
    index("mcp_token_family_idx").on(table.familyId, table.kind, table.revokedAt),
  ],
);

/** 本文・query・credentialを含めないMCP開示監査。 */
export const mcpAuditRecords = sqliteTable(
  "mcp_audit_records",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    connectionId: text("connection_id")
      .notNull()
      .references(() => mcpConnections.id),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    toolName: text("tool_name").notNull(),
    scope: text("scope").notNull(),
    accessProfile: text("access_profile").notNull(),
    outcome: text("outcome", { enum: ["success", "refused", "failure"] }).notNull(),
    reasonCode: text("reason_code").notNull(),
    resultCount: integer("result_count").notNull(),
    brainItemIds: text("brain_item_ids_json", { mode: "json" })
      .notNull()
      .$type<readonly string[]>(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("mcp_audit_account_occurred_idx").on(table.accountId, table.occurredAt),
    index("mcp_audit_expiry_idx").on(table.occurredAt),
  ],
);
