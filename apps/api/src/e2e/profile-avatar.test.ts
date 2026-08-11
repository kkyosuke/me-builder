import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = 1_786_406_400;
const lineAvatarUrl = "https://profile.line-scdn.net/line-avatar";
const e2eSetupTimeoutMs = 90_000;

let miniflare: Miniflare;
let database: D1Database;
let avatarBucket: R2Bucket;

function squarePng(size = 128): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, size);
  new DataView(bytes.buffer).setUint32(20, size);
  return bytes;
}

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function prepareAccount(db: D1Database): Promise<void> {
  await applyMigrations(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind("account-profile-e2e", timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind(
        "identity-profile-e2e",
        timestamp,
        timestamp,
        "account-profile-e2e",
        "line-profile-e2e",
      ),
  ]);
}

function bindings() {
  return {
    DB: database,
    AVATAR_BUCKET: avatarBucket,
    LINE_LOGIN_CHANNEL_ID: "1234567890",
    ENVIRONMENT: "test",
  };
}

function authorization() {
  return { Authorization: "Bearer known-token" };
}

describe("Profile avatar storage API local E2E", () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "profile-avatar-e2e" },
      r2Buckets: ["AVATAR_BUCKET"],
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    avatarBucket = (await miniflare.getR2Bucket("AVATAR_BUCKET")) as unknown as R2Bucket;
    await prepareAccount(database);
  }, e2eSetupTimeoutMs);

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          iss: "https://access.line.me",
          sub: "line-profile-e2e",
          aud: "1234567890",
          exp: timestamp + 86_400,
          name: "プロフィール利用者",
          picture: lineAvatarUrl,
        }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => miniflare.dispose());

  it("画像を保存し、GET 1回で画像を表示し、削除後はLINE画像へ戻す", async () => {
    const initialProfile = await app.request(
      "/api/profile",
      { headers: authorization() },
      bindings(),
    );
    expect(await initialProfile.json()).toMatchObject({
      role: "user",
      displayName: "プロフィール利用者",
      avatar: { source: "line", url: lineAvatarUrl, updatedAt: null },
    });

    const bytes = squarePng();
    const saved = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { ...authorization(), "Content-Type": "image/png" },
        body: bytes.slice().buffer as ArrayBuffer,
      },
      bindings(),
    );

    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(await saved.json()).toMatchObject({
      role: "user",
      displayName: "プロフィール利用者",
      avatar: { source: "uploaded", url: expect.stringMatching(/^data:image\/png;base64,/) },
    });
    expect((await avatarBucket.list()).objects).toHaveLength(1);
    expect(
      await database
        .prepare(
          "SELECT avatar_object_key, avatar_content_type, avatar_byte_size FROM account_profiles",
        )
        .first(),
    ).toMatchObject({
      avatar_content_type: "image/png",
      avatar_byte_size: bytes.byteLength,
    });

    const profile = await app.request("/api/profile", { headers: authorization() }, bindings());
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      avatar: { source: "uploaded", url: expect.stringMatching(/^data:image\/png;base64,/) },
    });

    const deleted = await app.request(
      "/api/profile/avatar",
      { method: "DELETE", headers: authorization() },
      bindings(),
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      avatar: { source: "line", url: lineAvatarUrl, updatedAt: null },
    });
    expect((await avatarBucket.list()).objects).toHaveLength(0);
    expect(
      await database.prepare("SELECT avatar_object_key FROM account_profiles").first(),
    ).toEqual({ avatar_object_key: null });
  });

  it("非正方形画像をR2へ保存しない", async () => {
    const bytes = squarePng();
    new DataView(bytes.buffer).setUint32(20, 64);
    const response = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { ...authorization(), "Content-Type": "image/png" },
        body: bytes.slice().buffer as ArrayBuffer,
      },
      bindings(),
    );
    expect(response.status).toBe(422);
    expect((await avatarBucket.list()).objects).toHaveLength(0);
  });

  it("PUTは画像bodyの検査より前に認証する", async () => {
    const response = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: Uint8Array.from([1, 2, 3]).buffer,
      },
      bindings(),
    );
    expect(response.status).toBe(401);
    expect((await avatarBucket.list()).objects).toHaveLength(0);
  });
});
