import path from "node:path";
import { D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiffSession, resolveLiffSession } from "./liff-session";

const CHANNEL_ID = "2010850319";
const SUB = "U0000000000000000000000000000000";
const ID_TOKEN = "dummy.id.token";

/**
 * `@me-builder/lib` のテーブル定義とマイグレーションをそのまま使い、
 * インメモリ SQLite を D1 の代わりに使います。
 */
function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
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
  return db as unknown as D1.shared.Client;
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

describe("LIFF session resolution", () => {
  let db: D1.shared.Client;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 既定引数は使わない。`call(undefined)` が既定値へ落ちて「未設定」を表現できなくなる。
  const call = (channelId = CHANNEL_ID) =>
    resolveLiffSession({ idToken: ID_TOKEN, lineLoginChannelId: channelId, db });

  it("友だち追加で作られた Account を引き当て、表示用の情報だけを返すこと", async () => {
    const followed = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId: SUB,
    });
    mockVerifyEndpoint({ json: validClaims });

    const result = await call();

    expect(result).toEqual({
      type: "resolved",
      session: {
        accountId: followed.account.id,
        role: "user",
        displayName: "うつし",
        pictureUrl: "https://example.com/picture.jpg",
      },
    });
    // sub (LINE の userId) を戻り値へ含めない
    expect(JSON.stringify(result)).not.toContain(SUB);
    // Account は増えず、line_login の identity が同じ Account へ紐づく
    expect(await db.select().from(D1.shared.schema.accounts).all()).toHaveLength(1);
    const identities = await db.select().from(D1.shared.schema.accountIdentities).all();
    expect(identities.map((i) => i.provider).sort()).toEqual(["line", "line_login"]);
    expect(new Set(identities.map((i) => i.accountId)).size).toBe(1);
    expect(await db.select().from(D1.shared.schema.accountProfiles).get()).toMatchObject({
      accountId: followed.account.id,
      displayName: "うつし",
    });
  });

  it("友だち追加前に2回呼び出してもAccountとidentityが増えないこと", async () => {
    mockVerifyEndpoint({ json: validClaims });

    await call();
    const second = await call();

    expect(second.type).toBe("resolved");
    expect(await db.select().from(D1.shared.schema.accounts).all()).toHaveLength(1);
    expect(await db.select().from(D1.shared.schema.accountIdentities).all()).toEqual([
      expect.objectContaining({ provider: "line_login", providerAccountId: SUB }),
    ]);
  });

  it("ID トークンが無い場合は unauthenticated を返し、検証エンドポイントを呼ばないこと", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await resolveLiffSession({
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
    expect(await db.select().from(D1.shared.schema.accounts).all()).toHaveLength(0);
  });

  it("aud が別チャネルの ID トークンを拒否すること", async () => {
    mockVerifyEndpoint({ json: { ...validClaims, aud: "9999999999" } });

    const result = await call();

    expect(result.type).toBe("unauthenticated");
  });

  it("該当するAccountが無い場合はWeb利用用のAccountを作って解決すること", async () => {
    mockVerifyEndpoint({ json: validClaims });

    const result = await call();

    expect(result).toEqual({
      type: "resolved",
      session: expect.objectContaining({
        accountId: expect.any(String),
        role: "user",
        displayName: "うつし",
      }),
    });
    expect(await db.select().from(D1.shared.schema.accounts).all()).toHaveLength(1);
    expect(await db.select().from(D1.shared.schema.accountIdentities).all()).toEqual([
      expect.objectContaining({ provider: "line_login", providerAccountId: SUB }),
    ]);
  });

  it("戻り値に HTTP のステータスコードを含めないこと", async () => {
    await D1.shared.action.account.upsertIdentity(db, { provider: "line", providerAccountId: SUB });
    mockVerifyEndpoint({ json: validClaims });

    const result = await call();

    // logic は HTTP を知らない。ステータスコードへの変換は controller の責務
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("body");
  });

  it("本人機能は未同意のAccountを拒否すること", async () => {
    mockVerifyEndpoint({ json: validClaims });

    const result = await createLiffSession({
      idToken: ID_TOKEN,
      lineLoginChannelId: CHANNEL_ID,
      db,
    });

    expect(result).toEqual({ type: "unauthenticated", reason: "terms_not_accepted" });
    expect(await db.select().from(D1.shared.schema.accounts).all()).toHaveLength(1);
  });

  it("現在の同意要件を満たしたAccountは本人機能を利用できること", async () => {
    mockVerifyEndpoint({ json: validClaims });
    const identity = await D1.shared.action.account.resolveAccountByLineLogin(db, SUB);
    await D1.shared.action.agreement.acceptCurrentTerms(db, identity.account.id);

    const result = await createLiffSession({
      idToken: ID_TOKEN,
      lineLoginChannelId: CHANNEL_ID,
      db,
    });

    expect(result).toMatchObject({
      type: "resolved",
      session: { accountId: identity.account.id, role: "user" },
    });
  });
});
