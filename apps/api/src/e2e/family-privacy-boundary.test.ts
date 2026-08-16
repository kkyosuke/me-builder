import path from "node:path";
import { type AccountDataNamespace, D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFamilySeatManagement } from "../logic/family-seat-management";
import { listPersonalData } from "../logic/personal-data";

const { createLiffSession } = vi.hoisted(() => ({ createLiffSession: vi.fn() }));
vi.mock("../logic/liff-session", () => ({ createLiffSession }));

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
  beforeEach(() => vi.clearAllMocks());

  it("支払者の席API・export境界から参加者のAccount IDと個人内容を取得できない", async () => {
    const db = createTestDb();
    const payer = await account(db, "privacy-payer");
    const member = await account(db, "privacy-member");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    await D1.shared.action.familySeat.reserveFamilySeat(db, payer, "private-invitation");
    await D1.shared.action.familySeat.activateFamilySeat(db, "private-invitation", member);
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId: payer, role: "user" },
    });

    const management = await getFamilySeatManagement({
      idToken: "payer-token",
      lineLoginChannelId: "channel",
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
});
