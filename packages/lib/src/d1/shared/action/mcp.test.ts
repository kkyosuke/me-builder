import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { upsertIdentity } from "./account";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  listAuditRecords,
  recordAudit,
  revokeConnection,
  rotateRefreshToken,
  verifyAccessToken,
} from "./mcp";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: D1とbetter-sqlite3の共通migration adapter。
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as SharedD1Client;
}

async function adminAccount(db: SharedD1Client) {
  const resolved = await upsertIdentity(db, {
    provider: "line_login",
    providerAccountId: "mcp-admin",
  });
  await db
    .update(schema.accounts)
    .set({ role: "admin" })
    .where(eq(schema.accounts.id, resolved.account.id));
  return resolved.account.id;
}

async function authorize(db: SharedD1Client, accountId: string, at: Date) {
  const request = await createAuthorizationRequest(
    db,
    {
      accountId,
      clientId: "https://client.example/metadata.json",
      clientName: "Example Client",
      metadataHash: "metadata-hash",
      redirectUri: "https://client.example/callback",
      state: "state",
      codeChallenge: "challenge",
      resource: "https://mcp.example/mcp",
    },
    at,
  );
  return await approveAuthorizationRequest(db, accountId, request.id, "code-hash", at);
}

describe("MCP OAuth storage", () => {
  it("codeを1回だけ交換し、生tokenではなくhashから現在admin接続を解決する", async () => {
    const db = createTestDb();
    const accountId = await adminAccount(db);
    const at = new Date("2026-08-21T00:00:00Z");
    const approved = await authorize(db, accountId, at);
    expect(approved).toBeDefined();
    const input = {
      codeHash: "code-hash",
      clientId: "https://client.example/metadata.json",
      redirectUri: "https://client.example/callback",
      resource: "https://mcp.example/mcp",
      codeChallenge: "challenge",
      tokens: { accessTokenHash: "access-hash", refreshTokenHash: "refresh-hash" },
    };
    await expect(
      exchangeAuthorizationCode(
        db,
        { ...input, clientId: "https://other.example/client.json" },
        at,
      ),
    ).resolves.toBeUndefined();
    await expect(exchangeAuthorizationCode(db, input, at)).resolves.toMatchObject({
      accessTokenExpiresAt: new Date("2026-08-21T01:00:00Z"),
    });
    await expect(exchangeAuthorizationCode(db, input, at)).resolves.toBeUndefined();
    await expect(
      verifyAccessToken(db, "access-hash", "https://mcp.example/mcp", at),
    ).resolves.toMatchObject({
      account: { id: accountId, role: "admin" },
      connection: { id: approved?.connectionId, status: "active" },
    });
    await expect(
      verifyAccessToken(db, "access-hash", "https://other.example/mcp", at),
    ).resolves.toBeUndefined();
  });

  it("refresh tokenをrotationし、使用済みtokenの再利用で同じfamilyを全失効する", async () => {
    const db = createTestDb();
    const accountId = await adminAccount(db);
    const at = new Date("2026-08-21T00:00:00Z");
    await authorize(db, accountId, at);
    await exchangeAuthorizationCode(
      db,
      {
        codeHash: "code-hash",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: "https://mcp.example/mcp",
        codeChallenge: "challenge",
        tokens: { accessTokenHash: "access-1", refreshTokenHash: "refresh-1" },
      },
      at,
    );
    await expect(
      rotateRefreshToken(
        db,
        {
          refreshTokenHash: "refresh-1",
          clientId: "https://client.example/metadata.json",
          tokens: { accessTokenHash: "access-2", refreshTokenHash: "refresh-2" },
        },
        new Date("2026-08-21T00:10:00Z"),
      ),
    ).resolves.toMatchObject({ type: "rotated" });
    await expect(
      rotateRefreshToken(
        db,
        {
          refreshTokenHash: "refresh-1",
          clientId: "https://client.example/metadata.json",
          tokens: { accessTokenHash: "access-3", refreshTokenHash: "refresh-3" },
        },
        new Date("2026-08-21T00:11:00Z"),
      ),
    ).resolves.toEqual({ type: "reuse" });
    await expect(
      rotateRefreshToken(
        db,
        {
          refreshTokenHash: "refresh-2",
          clientId: "https://client.example/metadata.json",
          tokens: { accessTokenHash: "access-4", refreshTokenHash: "refresh-4" },
        },
        new Date("2026-08-21T00:12:00Z"),
      ),
    ).resolves.toEqual({ type: "reuse" });
  });

  it("soft-delete済みrefresh tokenをrotation対象に戻さない", async () => {
    const db = createTestDb();
    const accountId = await adminAccount(db);
    const at = new Date("2026-08-21T00:00:00Z");
    await authorize(db, accountId, at);
    await exchangeAuthorizationCode(
      db,
      {
        codeHash: "code-hash",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: "https://mcp.example/mcp",
        codeChallenge: "challenge",
        tokens: { accessTokenHash: "access", refreshTokenHash: "deleted-refresh" },
      },
      at,
    );
    await db
      .update(schema.mcpTokens)
      .set({ isDeleted: true, deletedAt: at })
      .where(eq(schema.mcpTokens.tokenHash, "deleted-refresh"));

    await expect(
      rotateRefreshToken(db, {
        refreshTokenHash: "deleted-refresh",
        clientId: "https://client.example/metadata.json",
        tokens: { accessTokenHash: "next-access", refreshTokenHash: "next-refresh" },
      }),
    ).resolves.toEqual({ type: "invalid" });
  });

  it("解除で有効期限内access tokenも即時無効化し、監査は本文なしで保持する", async () => {
    const db = createTestDb();
    const accountId = await adminAccount(db);
    const at = new Date("2026-08-21T00:00:00Z");
    const approved = await authorize(db, accountId, at);
    await exchangeAuthorizationCode(
      db,
      {
        codeHash: "code-hash",
        clientId: "https://client.example/metadata.json",
        redirectUri: "https://client.example/callback",
        resource: "https://mcp.example/mcp",
        codeChallenge: "challenge",
        tokens: { accessTokenHash: "access", refreshTokenHash: "refresh" },
      },
      at,
    );
    await recordAudit(db, {
      accountId,
      connectionId: approved?.connectionId ?? "",
      clientId: "https://client.example/metadata.json",
      clientName: "Example Client",
      outcome: "success",
      reasonCode: "SEARCH_COMPLETED",
      brainItemIds: ["brain-1"],
    });
    expect(JSON.stringify(await listAuditRecords(db, accountId))).not.toContain("search query");
    await revokeConnection(db, accountId, approved?.connectionId ?? "", at);
    await expect(
      verifyAccessToken(db, "access", "https://mcp.example/mcp", at),
    ).resolves.toBeUndefined();
  });
});
