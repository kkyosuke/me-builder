import path from "node:path";
import { type AccountDataNamespace, D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { getFamilySeatManagement } from "../logic/family-seat-management";
import { listPersonalData } from "../logic/personal-data";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: migration test adapter for D1.
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      let results: unknown[] = [];
      sqlite.transaction(() => {
        results = queries.map((query) => (query as { run: () => unknown }).run());
      })();
      return results;
    },
  });
  return db as unknown as D1.shared.Client;
}

async function account(db: D1.shared.Client, name: string): Promise<string> {
  return (
    await D1.shared.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId: `U_${name}`,
    })
  ).account.id;
}

describe("family payer privacy boundary", () => {
  it("支払者の席API・export境界から参加者のAccount IDと個人内容を取得できない", async () => {
    const db = createTestDb();
    const payer = await account(db, "privacy-payer");
    const member = await account(db, "privacy-member");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    await D1.shared.action.familySeat.reserveFamilySeat(db, payer, "private-invitation");
    await D1.shared.action.familySeat.activateFamilySeat(db, "private-invitation", member);
    const management = await getFamilySeatManagement({
      actor: {
        accountId: payer,
        authenticationMethod: "liff",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      },
      db,
    });
    const serialized = JSON.stringify(management);
    expect(serialized).not.toContain(member);
    expect(serialized).not.toContain("private-invitation");
    expect(serialized).not.toMatch(/diary|diagnosis|profile|customer|subscription|portal/i);

    const execute = vi.fn().mockResolvedValue([
      {
        id: "payer-record",
        kind: "diary",
        title: "支払者本人の日記",
        value: "本人だけの内容",
        recordedAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
    const getByName = vi.fn(() => ({ execute }));
    const accountData = { getByName } as unknown as AccountDataNamespace;
    const personalData = await listPersonalData({
      actor: {
        accountId: payer,
        authenticationMethod: "liff",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      },
      accountData,
    });
    expect(getByName).toHaveBeenCalledTimes(1);
    expect(getByName).toHaveBeenCalledWith(payer);
    expect(getByName).not.toHaveBeenCalledWith(member);
    expect(personalData).toMatchObject({ type: "resolved" });
  });

  it("元参加者を席管理から切り離し、本人データは本人のAccountにだけ残す", async () => {
    const db = createTestDb();
    const payer = await account(db, "former-payer");
    const formerMember = await account(db, "former-member");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    await D1.shared.action.familySeat.reserveFamilySeat(db, payer, "former-invitation");
    const activated = await D1.shared.action.familySeat.activateFamilySeat(
      db,
      "former-invitation",
      formerMember,
    );
    if (activated.type !== "updated") throw new Error("family seat fixture was not activated");

    await D1.shared.action.familySeat.removeFamilySeat(db, activated.seat.id);

    await expect(
      getFamilySeatManagement({
        actor: {
          accountId: formerMember,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
        },
        db,
      }),
    ).resolves.toEqual({ type: "no-membership" });

    const execute = vi.fn().mockResolvedValue([
      {
        id: "former-member-record",
        kind: "diary",
        title: "元参加者本人の日記",
        value: "本人だけが取得できる内容",
        recordedAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
    const getByName = vi.fn(() => ({ execute }));
    const accountData = { getByName } as unknown as AccountDataNamespace;
    await expect(
      listPersonalData({
        actor: {
          accountId: formerMember,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
        },
        accountData,
      }),
    ).resolves.toMatchObject({ type: "resolved" });
    expect(getByName).toHaveBeenCalledWith(formerMember);
    expect(getByName).not.toHaveBeenCalledWith(payer);
  });
});
