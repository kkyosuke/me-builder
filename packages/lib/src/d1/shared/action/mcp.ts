import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accounts } from "../schema/account";
import {
  mcpAuditRecords,
  mcpAuthorizationCodes,
  mcpAuthorizationRequests,
  mcpConnections,
  mcpTokens,
} from "../schema/mcp";

export const MCP_SCOPE = "brain:search";
export const MCP_ACCESS_PROFILE = "owner";
export const MCP_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1_000;
export const MCP_REFRESH_TOKEN_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const MCP_AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1_000;
export const MCP_AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
export const MCP_AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

const lifecycle = (at: Date) => ({
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  isDeleted: false,
});

export type McpAuthorizationRequestInput = Readonly<{
  accountId: string;
  clientId: string;
  clientName: string;
  metadataHash: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  resource: string;
}>;

export async function createAuthorizationRequest(
  db: SharedD1Client,
  input: McpAuthorizationRequestInput,
  at = new Date(),
) {
  const request = {
    id: crypto.randomUUID(),
    ...input,
    expiresAt: new Date(at.getTime() + MCP_AUTHORIZATION_REQUEST_TTL_MS),
    consumedAt: null,
    ...lifecycle(at),
  };
  await db.insert(mcpAuthorizationRequests).values(request);
  return request;
}

export async function findAuthorizationRequest(
  db: SharedD1Client,
  accountId: string,
  requestId: string,
  at = new Date(),
) {
  return await db.query.mcpAuthorizationRequests.findFirst({
    where: (table, { and, eq, gt, isNull }) =>
      and(
        eq(table.id, requestId),
        eq(table.accountId, accountId),
        gt(table.expiresAt, at),
        isNull(table.consumedAt),
        eq(table.isDeleted, false),
      ),
  });
}

export async function rejectAuthorizationRequest(
  db: SharedD1Client,
  accountId: string,
  requestId: string,
  at = new Date(),
) {
  return Boolean(
    await db
      .update(mcpAuthorizationRequests)
      .set({ consumedAt: at, updatedAt: at })
      .where(
        and(
          eq(mcpAuthorizationRequests.id, requestId),
          eq(mcpAuthorizationRequests.accountId, accountId),
          isNull(mcpAuthorizationRequests.consumedAt),
          eq(mcpAuthorizationRequests.isDeleted, false),
        ),
      )
      .returning({ id: mcpAuthorizationRequests.id })
      .get(),
  );
}

export async function approveAuthorizationRequest(
  db: SharedD1Client,
  accountId: string,
  requestId: string,
  codeHash: string,
  at = new Date(),
) {
  const consumed = await db
    .update(mcpAuthorizationRequests)
    .set({ consumedAt: at, updatedAt: at })
    .where(
      and(
        eq(mcpAuthorizationRequests.id, requestId),
        eq(mcpAuthorizationRequests.accountId, accountId),
        isNull(mcpAuthorizationRequests.consumedAt),
        eq(mcpAuthorizationRequests.isDeleted, false),
      ),
    )
    .returning()
    .get();
  if (!consumed || consumed.expiresAt <= at) return undefined;

  const existing = await db.query.mcpConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.accountId, accountId), eq(table.clientId, consumed.clientId)),
  });
  const connectionId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await db
      .update(mcpConnections)
      .set({
        clientName: consumed.clientName,
        metadataHash: consumed.metadataHash,
        scope: MCP_SCOPE,
        accessProfile: MCP_ACCESS_PROFILE,
        status: "active",
        authorizedAt: at,
        revokedAt: null,
        isDeleted: false,
        deletedAt: null,
        updatedAt: at,
      })
      .where(eq(mcpConnections.id, existing.id));
    await db
      .update(mcpTokens)
      .set({ revokedAt: at, updatedAt: at })
      .where(and(eq(mcpTokens.connectionId, existing.id), isNull(mcpTokens.revokedAt)));
  } else {
    await db.insert(mcpConnections).values({
      id: connectionId,
      accountId,
      clientId: consumed.clientId,
      clientName: consumed.clientName,
      metadataHash: consumed.metadataHash,
      scope: MCP_SCOPE,
      accessProfile: MCP_ACCESS_PROFILE,
      status: "active",
      authorizedAt: at,
      lastUsedAt: null,
      revokedAt: null,
      ...lifecycle(at),
    });
  }
  await db.insert(mcpAuthorizationCodes).values({
    id: crypto.randomUUID(),
    connectionId,
    codeHash,
    redirectUri: consumed.redirectUri,
    codeChallenge: consumed.codeChallenge,
    resource: consumed.resource,
    expiresAt: new Date(at.getTime() + MCP_AUTHORIZATION_CODE_TTL_MS),
    usedAt: null,
    ...lifecycle(at),
  });
  return { connectionId, redirectUri: consumed.redirectUri, state: consumed.state };
}

export type IssuedMcpTokenHashes = Readonly<{
  accessTokenHash: string;
  refreshTokenHash: string;
  familyId?: string;
}>;

async function persistTokenPair(
  db: SharedD1Client,
  connectionId: string,
  resource: string,
  hashes: IssuedMcpTokenHashes,
  at: Date,
) {
  const familyId = hashes.familyId ?? crypto.randomUUID();
  await db.batch([
    db.insert(mcpTokens).values({
      id: crypto.randomUUID(),
      connectionId,
      familyId,
      kind: "access",
      tokenHash: hashes.accessTokenHash,
      resource,
      scope: MCP_SCOPE,
      expiresAt: new Date(at.getTime() + MCP_ACCESS_TOKEN_TTL_MS),
      idleExpiresAt: null,
      usedAt: null,
      revokedAt: null,
      ...lifecycle(at),
    }),
    db.insert(mcpTokens).values({
      id: crypto.randomUUID(),
      connectionId,
      familyId,
      kind: "refresh",
      tokenHash: hashes.refreshTokenHash,
      resource,
      scope: MCP_SCOPE,
      expiresAt: new Date(at.getTime() + MCP_REFRESH_TOKEN_IDLE_TTL_MS),
      idleExpiresAt: new Date(at.getTime() + MCP_REFRESH_TOKEN_IDLE_TTL_MS),
      usedAt: null,
      revokedAt: null,
      ...lifecycle(at),
    }),
  ]);
  return {
    familyId,
    accessTokenExpiresAt: new Date(at.getTime() + MCP_ACCESS_TOKEN_TTL_MS),
    refreshTokenIdleExpiresAt: new Date(at.getTime() + MCP_REFRESH_TOKEN_IDLE_TTL_MS),
  };
}

export async function exchangeAuthorizationCode(
  db: SharedD1Client,
  input: Readonly<{
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    codeChallenge: string;
    tokens: IssuedMcpTokenHashes;
  }>,
  at = new Date(),
) {
  const pending = await db
    .select({ code: mcpAuthorizationCodes, connection: mcpConnections })
    .from(mcpAuthorizationCodes)
    .innerJoin(mcpConnections, eq(mcpConnections.id, mcpAuthorizationCodes.connectionId))
    .where(
      and(
        eq(mcpAuthorizationCodes.codeHash, input.codeHash),
        eq(mcpAuthorizationCodes.redirectUri, input.redirectUri),
        eq(mcpAuthorizationCodes.resource, input.resource),
        eq(mcpAuthorizationCodes.codeChallenge, input.codeChallenge),
        isNull(mcpAuthorizationCodes.usedAt),
        eq(mcpAuthorizationCodes.isDeleted, false),
        eq(mcpConnections.clientId, input.clientId),
        eq(mcpConnections.status, "active"),
        eq(mcpConnections.isDeleted, false),
      ),
    )
    .get();
  if (!pending || pending.code.expiresAt <= at) return undefined;
  const consumed = await db
    .update(mcpAuthorizationCodes)
    .set({ usedAt: at, updatedAt: at })
    .where(and(eq(mcpAuthorizationCodes.id, pending.code.id), isNull(mcpAuthorizationCodes.usedAt)))
    .returning({ id: mcpAuthorizationCodes.id })
    .get();
  if (!consumed) return undefined;
  return await persistTokenPair(db, pending.connection.id, input.resource, input.tokens, at);
}

export async function rotateRefreshToken(
  db: SharedD1Client,
  input: Readonly<{
    refreshTokenHash: string;
    clientId: string;
    tokens: Omit<IssuedMcpTokenHashes, "familyId">;
  }>,
  at = new Date(),
) {
  const found = await db.query.mcpTokens.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.tokenHash, input.refreshTokenHash),
        eq(table.kind, "refresh"),
        eq(table.isDeleted, false),
      ),
  });
  if (!found) return { type: "invalid" as const };
  const connection = await db.query.mcpConnections.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, found.connectionId),
        eq(table.clientId, input.clientId),
        eq(table.status, "active"),
        eq(table.isDeleted, false),
      ),
  });
  // 他clientのtokenを提示しても、正当なtokenを消費・失効させない。
  if (!connection) return { type: "invalid" as const };
  if (found.usedAt || found.revokedAt) {
    await db
      .update(mcpTokens)
      .set({ revokedAt: at, updatedAt: at })
      .where(and(eq(mcpTokens.familyId, found.familyId), isNull(mcpTokens.revokedAt)));
    return { type: "reuse" as const };
  }
  if (found.expiresAt <= at || !found.idleExpiresAt || found.idleExpiresAt <= at) {
    return { type: "expired" as const };
  }
  const consumed = await db
    .update(mcpTokens)
    .set({ usedAt: at, revokedAt: at, updatedAt: at })
    .where(and(eq(mcpTokens.id, found.id), isNull(mcpTokens.usedAt), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id })
    .get();
  if (!consumed) return { type: "reuse" as const };
  const issued = await persistTokenPair(
    db,
    connection.id,
    found.resource,
    { ...input.tokens, familyId: found.familyId },
    at,
  );
  return { type: "rotated" as const, connection, resource: found.resource, ...issued };
}

/** refresh tokenを消費せず、token endpointで現在のAccount条件を確認する。 */
export async function findRefreshTokenAccount(
  db: SharedD1Client,
  refreshTokenHash: string,
  clientId: string,
) {
  const row = await db
    .select({ token: mcpTokens, connection: mcpConnections, account: accounts })
    .from(mcpTokens)
    .innerJoin(mcpConnections, eq(mcpConnections.id, mcpTokens.connectionId))
    .innerJoin(accounts, eq(accounts.id, mcpConnections.accountId))
    .where(
      and(
        eq(mcpTokens.tokenHash, refreshTokenHash),
        eq(mcpTokens.kind, "refresh"),
        eq(mcpTokens.isDeleted, false),
        eq(mcpConnections.clientId, clientId),
        eq(mcpConnections.status, "active"),
        eq(mcpConnections.isDeleted, false),
        eq(accounts.role, "admin"),
        eq(accounts.status, "active"),
        eq(accounts.isDeleted, false),
      ),
    )
    .get();
  return row;
}

export async function verifyAccessToken(
  db: SharedD1Client,
  tokenHash: string,
  resource: string,
  at = new Date(),
) {
  const row = await db
    .select({ token: mcpTokens, connection: mcpConnections, account: accounts })
    .from(mcpTokens)
    .innerJoin(mcpConnections, eq(mcpConnections.id, mcpTokens.connectionId))
    .innerJoin(accounts, eq(accounts.id, mcpConnections.accountId))
    .where(
      and(
        eq(mcpTokens.tokenHash, tokenHash),
        eq(mcpTokens.kind, "access"),
        eq(mcpTokens.resource, resource),
        isNull(mcpTokens.revokedAt),
        eq(mcpTokens.isDeleted, false),
        eq(mcpConnections.status, "active"),
        eq(mcpConnections.isDeleted, false),
        eq(accounts.role, "admin"),
        eq(accounts.status, "active"),
        eq(accounts.isDeleted, false),
      ),
    )
    .get();
  if (!row || row.token.expiresAt <= at) return undefined;
  return row;
}

export async function touchConnection(db: SharedD1Client, connectionId: string, at = new Date()) {
  await db
    .update(mcpConnections)
    .set({ lastUsedAt: at, updatedAt: at })
    .where(and(eq(mcpConnections.id, connectionId), eq(mcpConnections.status, "active")));
}

export async function listConnections(db: SharedD1Client, accountId: string) {
  return await db
    .select({
      id: mcpConnections.id,
      clientId: mcpConnections.clientId,
      clientName: mcpConnections.clientName,
      scope: mcpConnections.scope,
      accessProfile: mcpConnections.accessProfile,
      status: mcpConnections.status,
      authorizedAt: mcpConnections.authorizedAt,
      lastUsedAt: mcpConnections.lastUsedAt,
      revokedAt: mcpConnections.revokedAt,
    })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.accountId, accountId), eq(mcpConnections.isDeleted, false)))
    .orderBy(desc(mcpConnections.updatedAt));
}

export async function revokeConnection(
  db: SharedD1Client,
  accountId: string,
  connectionId: string,
  at = new Date(),
) {
  const connection = await db
    .update(mcpConnections)
    .set({ status: "revoked", revokedAt: at, updatedAt: at })
    .where(
      and(
        eq(mcpConnections.id, connectionId),
        eq(mcpConnections.accountId, accountId),
        eq(mcpConnections.status, "active"),
        eq(mcpConnections.isDeleted, false),
      ),
    )
    .returning({ id: mcpConnections.id })
    .get();
  if (!connection) return false;
  await db
    .update(mcpTokens)
    .set({ revokedAt: at, updatedAt: at })
    .where(and(eq(mcpTokens.connectionId, connectionId), isNull(mcpTokens.revokedAt)));
  return true;
}

export type McpAuditInput = Readonly<{
  accountId: string;
  connectionId: string;
  clientId: string;
  clientName: string;
  outcome: "success" | "refused" | "failure";
  reasonCode: string;
  brainItemIds?: readonly string[];
}>;

export async function recordAudit(db: SharedD1Client, input: McpAuditInput, at = new Date()) {
  const ids = [...new Set(input.brainItemIds ?? [])].slice(0, 5);
  await db.insert(mcpAuditRecords).values({
    id: crypto.randomUUID(),
    ...input,
    toolName: "search_my_brain",
    scope: MCP_SCOPE,
    accessProfile: MCP_ACCESS_PROFILE,
    resultCount: ids.length,
    brainItemIds: ids,
    occurredAt: at,
    ...lifecycle(at),
  });
}

export async function listAuditRecords(db: SharedD1Client, accountId: string, limit = 100) {
  return await db
    .select()
    .from(mcpAuditRecords)
    .where(and(eq(mcpAuditRecords.accountId, accountId), eq(mcpAuditRecords.isDeleted, false)))
    .orderBy(desc(mcpAuditRecords.occurredAt), desc(mcpAuditRecords.id))
    .limit(Math.max(1, Math.min(limit, 100)));
}

/** 90日保持はbest effort。定期処理とrequest時の双方から安全に呼べる。 */
export async function pruneAuditRecords(db: SharedD1Client, at = new Date()) {
  const cutoff = new Date(at.getTime() - MCP_AUDIT_RETENTION_MS);
  const deleted = await db
    .delete(mcpAuditRecords)
    .where(lt(mcpAuditRecords.occurredAt, cutoff))
    .returning({ id: mcpAuditRecords.id });
  return deleted.length;
}
