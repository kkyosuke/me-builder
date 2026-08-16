import path from "node:path";
import { D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import {
  acceptFamilyInvitation,
  cancelFamilyInvitation,
  declineFamilyInvitation,
  getFamilySeatManagement,
  issueFamilySeatInvitation,
  leaveFamilyPack,
  removeFamilyMember,
} from "./family-seat-management";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: migration test adapter for the D1 client.
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

function asAccount(accountId: string, now = new Date("2026-08-16T00:00:00.000Z")) {
  return {
    now: () => now,
    createSession: async () => ({
      type: "resolved" as const,
      session: { accountId, role: "user" as const },
    }),
  };
}

const params = (db: D1.shared.Client) => ({
  db,
  idToken: "verified-token",
  lineLoginChannelId: "line-login-channel",
});

describe("family seat API authorization", () => {
  it("支払者だけが招待を取消・参加者を削除でき、返却値に個人内容を含めない", async () => {
    const db = createTestDb();
    const payer = await account(db, "payer");
    const member = await account(db, "member");
    const thirdParty = await account(db, "third-party");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);

    const issued = await issueFamilySeatInvitation(params(db), asAccount(payer));
    if (issued.type !== "created") throw new Error("invitation fixture was not created");
    await expect(
      cancelFamilyInvitation({ ...params(db), seatId: issued.seat.id }, asAccount(thirdParty)),
    ).resolves.toEqual({ type: "forbidden" });
    await expect(
      acceptFamilyInvitation({ ...params(db), token: issued.token }, asAccount(payer)),
    ).resolves.toEqual({ type: "forbidden" });
    await expect(
      acceptFamilyInvitation({ ...params(db), token: issued.token }, asAccount(member)),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "active" } });

    const management = await getFamilySeatManagement(params(db), asAccount(payer));
    expect(management).toMatchObject({ type: "resolved", role: "payer", maxSeats: 4 });
    expect(JSON.stringify(management)).not.toMatch(
      /memberAccountId|invitationId|diary|diagnosis|profile|relationship/i,
    );
    await expect(
      removeFamilyMember({ ...params(db), seatId: issued.seat.id }, asAccount(thirdParty)),
    ).resolves.toEqual({ type: "forbidden" });
    await expect(
      removeFamilyMember({ ...params(db), seatId: issued.seat.id }, asAccount(payer)),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "removed" } });
  });

  it("tokenは一度だけ使え、承諾したAccountと別Accountによる再利用を拒否する", async () => {
    const db = createTestDb();
    const payer = await account(db, "single-use-payer");
    const member = await account(db, "single-use-member");
    const attacker = await account(db, "single-use-attacker");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    const issued = await issueFamilySeatInvitation(params(db), asAccount(payer));
    if (issued.type !== "created") throw new Error("invitation fixture was not created");

    await expect(
      acceptFamilyInvitation({ ...params(db), token: issued.token }, asAccount(member)),
    ).resolves.toMatchObject({ type: "updated" });
    await expect(
      acceptFamilyInvitation({ ...params(db), token: issued.token }, asAccount(attacker)),
    ).resolves.toEqual({ type: "token-used" });
    await expect(
      declineFamilyInvitation({ ...params(db), token: issued.token }, asAccount(attacker)),
    ).resolves.toEqual({ type: "token-used" });
  });

  it("48時間を過ぎたtokenを失効し、辞退と退出を本人だけに許可する", async () => {
    const db = createTestDb();
    const payer = await account(db, "expiry-payer");
    const member = await account(db, "expiry-member");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    const issued = await issueFamilySeatInvitation(params(db), asAccount(payer));
    if (issued.type !== "created") throw new Error("invitation fixture was not created");
    const afterExpiry = new Date("2026-08-18T00:00:00.001Z");
    await expect(
      acceptFamilyInvitation(
        { ...params(db), token: issued.token },
        asAccount(member, afterExpiry),
      ),
    ).resolves.toEqual({ type: "expired" });

    const replacement = await issueFamilySeatInvitation(params(db), asAccount(payer));
    if (replacement.type !== "created") throw new Error("replacement fixture was not created");
    await expect(
      declineFamilyInvitation({ ...params(db), token: replacement.token }, asAccount(member)),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "cancelled" } });

    const joining = await issueFamilySeatInvitation(params(db), asAccount(payer));
    if (joining.type !== "created") throw new Error("joining fixture was not created");
    await acceptFamilyInvitation({ ...params(db), token: joining.token }, asAccount(member));
    await expect(leaveFamilyPack(params(db), asAccount(payer))).resolves.toEqual({
      type: "not-found",
    });
    await expect(leaveFamilyPack(params(db), asAccount(member))).resolves.toMatchObject({
      type: "updated",
      seat: { status: "left" },
    });
  });
});
