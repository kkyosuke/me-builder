import path from "node:path";
import { d1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiffSession } from "./liff-session";

const CHANNEL_ID = "2010850319";
const SUB = "U0000000000000000000000000000000";
const ID_TOKEN = "dummy.id.token";

/**
 * `@me-builder/lib` のテーブル定義とマイグレーションをそのまま使い、
 * インメモリ SQLite を D1 の代わりに使います。
 */
function createTestDb(): d1.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: d1.schema });
  // biome-ignore lint/suspicious/noExplicitAny: drizzle の migrate はドライバごとの型を要求する
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const q of queries) {
        results.push(await q);
      }
      return results;
    },
    writable: true,
  });
  return db as unknown as d1.Client;
}

/** ID トークンの検証エンドポイントの応答を差し替えます。 */
function mockVerifyEndpoint(response: { status?: number; json: unknown }): void {
  vi.stubGlobal("fetch", async () => {
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response.json,
    };
  });
}

const validClaims = {
  iss: "https://access.line.me",
  sub: SUB,
  aud: CHANNEL_ID,
  exp: 1785000000,
  name: "うつし",
  picture: "https://example.com/picture.jpg",
};

describe("createLiffSession", () => {
  let db: d1.Client;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 既定引数は使わない。`call(undefined)` が既定値へ落ちて「未設定」を表現できなくなる。
  const call = (channelId = CHANNEL_ID) =>
    createLiffSession({ idToken: ID_TOKEN, lineLoginChannelId: channelId, db });

  it("友だち追加で作られた Account を引き当て、表示用の情報だけを返すこと", async () => {
    const followed = await d1.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId: SUB,
    });
    mockVerifyEndpoint({ json: validClaims });

    const result = await call();

    expect(result).toEqual({
      type: "resolved",
      session: {
        accountId: followed.account.id,
        displayName: "うつし",
        pictureUrl: "https://example.com/picture.jpg",
      },
    });
    // sub (LINE の userId) を戻り値へ含めない
    expect(JSON.stringify(result)).not.toContain(SUB);
    // Account は増えず、line_login の identity が同じ Account へ紐づく
    expect(await db.select().from(d1.schema.accounts).all()).toHaveLength(1);
    const identities = await db.select().from(d1.schema.accountIdentities).all();
    expect(identities.map((i) => i.provider).sort()).toEqual(["line", "line_login"]);
    expect(new Set(identities.map((i) => i.accountId)).size).toBe(1);
  });

  it("2 回目の呼び出しでも identity が増えないこと", async () => {
    await d1.action.account.upsertIdentity(db, { provider: "line", providerAccountId: SUB });
    mockVerifyEndpoint({ json: validClaims });

    await call();
    const second = await call();

    expect(second.type).toBe("resolved");
    expect(await db.select().from(d1.schema.accountIdentities).all()).toHaveLength(2);
  });

  it("ID トークンが無い場合は unauthenticated を返し、検証エンドポイントを呼ばないこと", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await createLiffSession({
      idToken: undefined,
      lineLoginChannelId: CHANNEL_ID,
      db,
    });

    expect(result.type).toBe("unauthenticated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("LINE Login チャネル ID が未設定なら not-configured を返すこと", async () => {
    mockVerifyEndpoint({ json: validClaims });

    const result = await call("");

    expect(result.type).toBe("not-configured");
  });

  it("ID トークンの検証に失敗した場合は unauthenticated を返し、Account を作らないこと", async () => {
    mockVerifyEndpoint({ status: 400, json: { error: "invalid_request" } });

    const result = await call();

    expect(result.type).toBe("unauthenticated");
    expect(await db.select().from(d1.schema.accounts).all()).toHaveLength(0);
  });

  it("aud が別チャネルの ID トークンを拒否すること", async () => {
    mockVerifyEndpoint({ json: { ...validClaims, aud: "9999999999" } });

    const result = await call();

    expect(result.type).toBe("unauthenticated");
  });

  it("該当する Account が無い場合は account-not-found を返し、Account を作らないこと", async () => {
    mockVerifyEndpoint({ json: validClaims });

    const result = await call();

    expect(result.type).toBe("account-not-found");
    expect(await db.select().from(d1.schema.accounts).all()).toHaveLength(0);
  });

  it("戻り値に HTTP のステータスコードを含めないこと", async () => {
    await d1.action.account.upsertIdentity(db, { provider: "line", providerAccountId: SUB });
    mockVerifyEndpoint({ json: validClaims });

    const result = await call();

    // logic は HTTP を知らない。ステータスコードへの変換は controller の責務
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("body");
  });
});
