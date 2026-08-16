import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { createApplicationSessionFixture } from "../testing/application-session";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = 1_786_406_400;
const lineAvatarUrl = "https://profile.line-scdn.net/line-avatar";
const e2eSetupTimeoutMs = 90_000;

let miniflare: Miniflare;
let database: D1Database;
let avatarBucket: R2Bucket;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;
let sessionHeaders: Record<string, string>;

const squarePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwHwwZGP6DAQBJyAn3iFfyTAAAAABJRU5ErkJggg==";

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function squarePng(): Uint8Array {
  return Uint8Array.from(atob(squarePngBase64), (value) => value.charCodeAt(0));
}

function nonSquarePng(): Uint8Array {
  const bytes = squarePng();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(20, 1);
  view.setUint32(29, crc32(bytes, 12, 29));
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
  await D1.shared.action.agreement.acceptCurrentTerms(
    D1.shared.client.create(db),
    "account-profile-e2e",
  );
}

function bindings() {
  return {
    DB: database,
    AVATAR_BUCKET: avatarBucket,
    ...sessionFixture.bindings,
    ENVIRONMENT: "test",
  };
}

function sessionHeadersForRequest() {
  return sessionHeaders;
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
    sessionFixture = createApplicationSessionFixture(database);
  }, e2eSetupTimeoutMs);

  beforeEach(async () => {
    sessionHeaders = (
      await sessionFixture.issue("account-profile-e2e", {
        displayName: "プロフィール利用者",
        pictureUrl: lineAvatarUrl,
      })
    ).headers;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => miniflare.dispose());

  it("画像を保存し、GET 1回で画像を表示し、削除後はLINE画像へ戻す", async () => {
    const initialProfile = await app.request(
      "/api/profile",
      { headers: sessionHeadersForRequest() },
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
        headers: { ...sessionHeadersForRequest(), "Content-Type": "image/png" },
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

    const profile = await app.request(
      "/api/profile",
      { headers: sessionHeadersForRequest() },
      bindings(),
    );
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      avatar: { source: "uploaded", url: expect.stringMatching(/^data:image\/png;base64,/) },
    });

    const image = await app.request(
      "/api/profile/avatar",
      { headers: sessionHeadersForRequest() },
      bindings(),
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);

    const deleted = await app.request(
      "/api/profile/avatar",
      { method: "DELETE", headers: sessionHeadersForRequest() },
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

  it("R2 object欠落時はGETを縮退し、DELETEとPUTのどちらでも自己回復できる", async () => {
    const bytes = squarePng();
    const initialPut = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { ...sessionHeadersForRequest(), "Content-Type": "image/png" },
        body: bytes.slice().buffer as ArrayBuffer,
      },
      bindings(),
    );
    expect(initialPut.status).toBe(200);

    const [stored] = (await avatarBucket.list()).objects;
    expect(stored).toBeDefined();
    if (!stored) throw new Error("Expected the avatar fixture in R2");
    await avatarBucket.delete(stored.key);
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const degraded = await app.request(
      "/api/profile",
      { headers: sessionHeadersForRequest() },
      bindings(),
    );
    expect(degraded.status).toBe(200);
    expect(await degraded.json()).toMatchObject({
      role: "user",
      displayName: "プロフィール利用者",
      avatar: { source: "line", url: lineAvatarUrl, updatedAt: null },
    });
    expect(errorLog).toHaveBeenCalledWith(
      {
        event: "profile.avatar.read.degraded",
        outcome: "degraded",
        reason: "object-missing",
      },
      "Profile avatar read degraded to the fallback profile",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("account-profile-e2e");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(stored.key);

    const deletedMissingAvatar = await app.request(
      "/api/profile/avatar",
      { method: "DELETE", headers: sessionHeadersForRequest() },
      bindings(),
    );
    expect(deletedMissingAvatar.status).toBe(200);
    expect(await deletedMissingAvatar.json()).toMatchObject({
      avatar: { source: "line", url: lineAvatarUrl, updatedAt: null },
    });
    expect(
      await database.prepare("SELECT avatar_object_key FROM account_profiles").first(),
    ).toEqual({ avatar_object_key: null });

    const secondPut = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { ...sessionHeadersForRequest(), "Content-Type": "image/png" },
        body: bytes.slice().buffer as ArrayBuffer,
      },
      bindings(),
    );
    expect(secondPut.status).toBe(200);
    const [secondStored] = (await avatarBucket.list()).objects;
    expect(secondStored).toBeDefined();
    if (!secondStored) throw new Error("Expected the second avatar fixture in R2");
    await avatarBucket.delete(secondStored.key);

    const secondDegraded = await app.request(
      "/api/profile",
      { headers: sessionHeadersForRequest() },
      bindings(),
    );
    expect(secondDegraded.status).toBe(200);

    const recoveredByPut = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { ...sessionHeadersForRequest(), "Content-Type": "image/png" },
        body: bytes.slice().buffer as ArrayBuffer,
      },
      bindings(),
    );
    expect(recoveredByPut.status).toBe(200);
    expect(await recoveredByPut.json()).toMatchObject({ avatar: { source: "uploaded" } });
    expect((await avatarBucket.list()).objects).toHaveLength(1);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("account-profile-e2e");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secondStored.key);

    const cleanup = await app.request(
      "/api/profile/avatar",
      { method: "DELETE", headers: sessionHeadersForRequest() },
      bindings(),
    );
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toMatchObject({
      avatar: { source: "line", url: lineAvatarUrl, updatedAt: null },
    });
    expect((await avatarBucket.list()).objects).toHaveLength(0);
    expect(
      await database.prepare("SELECT avatar_object_key FROM account_profiles").first(),
    ).toEqual({ avatar_object_key: null });
  });

  it("非正方形画像をR2へ保存しない", async () => {
    const bytes = nonSquarePng();
    const response = await app.request(
      "/api/profile/avatar",
      {
        method: "PUT",
        headers: { ...sessionHeadersForRequest(), "Content-Type": "image/png" },
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
