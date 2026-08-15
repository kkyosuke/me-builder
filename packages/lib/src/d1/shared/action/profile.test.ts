import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import {
  clearProfileAvatar,
  getProfileAvatar,
  saveVerifiedDisplayName,
  setProfileAvatar,
} from "./profile";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly PromiseLike<unknown>[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  });
  return db as unknown as SharedD1Client;
}

const avatar = {
  objectKey: "accounts/account-1/profile/avatar/hash.webp",
  contentType: "image/webp" as const,
  byteSize: 1234,
  etag: "etag-1",
  updatedAt: new Date("2026-08-11T00:00:00.000Z"),
};

async function createAccount(db: SharedD1Client): Promise<void> {
  await db.insert(schema.accounts).values({ id: "account-1" }).run();
}

describe("Shared D1 account profile avatar", () => {
  it("Accountの現在画像を保存・取得・削除する", async () => {
    const db = createTestDb();
    await createAccount(db);

    await expect(setProfileAvatar(db, "account-1", avatar)).resolves.toMatchObject({
      outcome: "created",
      previousObjectKey: null,
    });
    await expect(getProfileAvatar(db, "account-1")).resolves.toEqual(avatar);
    await expect(clearProfileAvatar(db, "account-1")).resolves.toEqual({
      outcome: "cleared",
      previousObjectKey: avatar.objectKey,
    });
    await expect(getProfileAvatar(db, "account-1")).resolves.toBeNull();
  });

  it("同じ画像の再保存を変更なしとして扱う", async () => {
    const db = createTestDb();
    await createAccount(db);
    await setProfileAvatar(db, "account-1", avatar);

    await expect(
      setProfileAvatar(db, "account-1", {
        ...avatar,
        updatedAt: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "unchanged",
      avatar,
      previousObjectKey: avatar.objectKey,
    });
  });

  it("同時更新でも成功した直前のobject keyを返す", async () => {
    const db = createTestDb();
    await createAccount(db);
    await setProfileAvatar(db, "account-1", avatar);
    const second = {
      ...avatar,
      objectKey: "accounts/account-1/profile/avatar/hash-2.webp",
      etag: "etag-2",
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
    };
    const third = {
      ...avatar,
      objectKey: "accounts/account-1/profile/avatar/hash-3.webp",
      etag: "etag-3",
      updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    };

    const results = await Promise.all([
      setProfileAvatar(db, "account-1", second),
      setProfileAvatar(db, "account-1", third),
    ]);
    const final = await getProfileAvatar(db, "account-1");
    const finalResult = results.find(
      ({ avatar: resultAvatar }) => resultAvatar.objectKey === final?.objectKey,
    );
    const earlierResult = results.find((result) => result !== finalResult);
    expect(earlierResult?.previousObjectKey).toBe(avatar.objectKey);
    expect(finalResult?.previousObjectKey).toBe(earlierResult?.avatar.objectKey);
  });

  it("別Account用のR2 object keyを保存できない", async () => {
    const db = createTestDb();
    await createAccount(db);

    await expect(
      setProfileAvatar(db, "account-1", {
        ...avatar,
        objectKey: "accounts/account-2/profile/avatar/hash.webp",
      }),
    ).rejects.toThrow("Profile avatar object does not belong to the account");
  });

  it("存在しないAccountのプロフィールを作成できない", async () => {
    const db = createTestDb();

    await expect(
      setProfileAvatar(db, "missing-account", {
        ...avatar,
        objectKey: "accounts/missing-account/profile/avatar/hash.webp",
      }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("Shared D1 verified display name", () => {
  it("検証済み表示名をtrimして保存し、同じ値では更新日時を動かさない", async () => {
    const db = createTestDb();
    await createAccount(db);
    const firstAt = new Date("2026-08-15T01:00:00.000Z");
    await saveVerifiedDisplayName(db, "account-1", "  山田 花子  ", firstAt);
    await saveVerifiedDisplayName(
      db,
      "account-1",
      "山田 花子",
      new Date("2026-08-15T02:00:00.000Z"),
    );

    expect(
      await db
        .select()
        .from(schema.accountProfiles)
        .where(eq(schema.accountProfiles.accountId, "account-1"))
        .get(),
    ).toMatchObject({ displayName: "山田 花子", displayNameUpdatedAt: firstAt });
  });

  it("表示名の更新でも現在のアバターを維持する", async () => {
    const db = createTestDb();
    await createAccount(db);
    await setProfileAvatar(db, "account-1", avatar);
    await saveVerifiedDisplayName(db, "account-1", "山田 花子");

    await expect(getProfileAvatar(db, "account-1")).resolves.toEqual(avatar);
  });
});
