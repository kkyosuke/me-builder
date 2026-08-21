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

function asAccount(accountId: string) {
  return {
    accountId,
    authenticationMethod: "liff" as const,
    authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
  };
}

const params = (db: D1.shared.Client, accountId: string) => ({
  db,
  actor: asAccount(accountId),
});

const at = (now = new Date("2026-08-16T00:00:00.000Z")) => ({ now: () => now });

describe("family seat API authorization", () => {
  it("支払者だけが招待を取消・参加者を削除でき、返却値に個人内容を含めない", async () => {
    const db = createTestDb();
    const payer = await account(db, "payer");
    const member = await account(db, "member");
    const thirdParty = await account(db, "third-party");
    await db.insert(D1.shared.schema.accountProfiles).values({
      accountId: member,
      displayName: "家族A",
      displayNameUpdatedAt: new Date("2026-08-16T00:00:00.000Z"),
    });
    await D1.shared.action.familySeat.createFamilyPack(db, payer);

    const issued = await issueFamilySeatInvitation(params(db, payer), at());
    if (issued.type !== "created") throw new Error("invitation fixture was not created");
    await expect(
      cancelFamilyInvitation({ ...params(db, thirdParty), seatId: issued.seat.id }, at()),
    ).resolves.toEqual({ type: "forbidden" });
    await expect(
      acceptFamilyInvitation({ ...params(db, payer), token: issued.token }, at()),
    ).resolves.toEqual({ type: "forbidden" });
    await expect(
      acceptFamilyInvitation({ ...params(db, member), token: issued.token }, at()),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "active" } });

    const management = await getFamilySeatManagement(params(db, payer));
    expect(management).toMatchObject({ type: "resolved", role: "payer", maxSeats: 4 });
    expect(management).toMatchObject({
      seats: expect.arrayContaining([expect.objectContaining({ displayName: "家族A" })]),
    });
    expect(JSON.stringify(management)).not.toMatch(
      /memberAccountId|invitationId|diary|diagnosis|profile|relationship/i,
    );
    await expect(
      removeFamilyMember({ ...params(db, thirdParty), seatId: issued.seat.id }, at()),
    ).resolves.toEqual({ type: "forbidden" });
    await expect(
      removeFamilyMember({ ...params(db, payer), seatId: issued.seat.id }, at()),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "removed" } });
  });

  it("tokenは一度だけ使え、承諾したAccountと別Accountによる再利用を拒否する", async () => {
    const db = createTestDb();
    const payer = await account(db, "single-use-payer");
    const member = await account(db, "single-use-member");
    const attacker = await account(db, "single-use-attacker");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    const issued = await issueFamilySeatInvitation(params(db, payer), at());
    if (issued.type !== "created") throw new Error("invitation fixture was not created");

    await expect(
      acceptFamilyInvitation({ ...params(db, member), token: issued.token }, at()),
    ).resolves.toMatchObject({ type: "updated" });
    await expect(
      acceptFamilyInvitation({ ...params(db, attacker), token: issued.token }, at()),
    ).resolves.toEqual({ type: "token-used" });
    await expect(
      declineFamilyInvitation({ ...params(db, attacker), token: issued.token }, at()),
    ).resolves.toEqual({ type: "token-used" });
  });

  it("同じ招待への同時承諾は1人だけを参加者として確定する", async () => {
    const db = createTestDb();
    const payer = await account(db, "concurrent-accept-payer");
    const firstCandidate = await account(db, "concurrent-accept-first");
    const secondCandidate = await account(db, "concurrent-accept-second");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    const issued = await issueFamilySeatInvitation(params(db, payer), at());
    if (issued.type !== "created") throw new Error("invitation fixture was not created");

    const outcomes = await Promise.all([
      acceptFamilyInvitation({ ...params(db, firstCandidate), token: issued.token }, at()),
      acceptFamilyInvitation({ ...params(db, secondCandidate), token: issued.token }, at()),
    ]);

    expect(outcomes.map(({ type }) => type).sort()).toEqual(["token-used", "updated"]);
    const activeCandidates = await Promise.all(
      [firstCandidate, secondCandidate].map((accountId) =>
        getFamilySeatManagement(params(db, accountId)),
      ),
    );
    expect(activeCandidates.filter(({ type }) => type === "resolved")).toHaveLength(1);
    expect(activeCandidates.filter(({ type }) => type === "no-membership")).toHaveLength(1);
    const acceptedIndex = activeCandidates.findIndex(({ type }) => type === "resolved");
    const acceptedAccountId = [firstCandidate, secondCandidate][acceptedIndex];
    expect(acceptedAccountId).toBeTruthy();
    await expect(
      db.query.familySeatInvitations.findFirst({
        where: (table, { eq }) => eq(table.seatId, issued.seat.id),
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      claimedByAccountId: acceptedAccountId,
    });
    await expect(
      db.query.familySeats.findFirst({
        where: (table, { eq }) => eq(table.id, issued.seat.id),
      }),
    ).resolves.toMatchObject({
      status: "active",
      memberAccountId: acceptedAccountId,
    });
  });

  it("支払者の削除と参加者の退出が競合しても席と利用権限を失った状態へ収束する", async () => {
    const db = createTestDb();
    const payer = await account(db, "concurrent-leave-payer");
    const member = await account(db, "concurrent-leave-member");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    const issued = await issueFamilySeatInvitation(params(db, payer), at());
    if (issued.type !== "created") throw new Error("invitation fixture was not created");
    await acceptFamilyInvitation({ ...params(db, member), token: issued.token }, at());

    const outcomes = await Promise.all([
      removeFamilyMember({ ...params(db, payer), seatId: issued.seat.id }, at()),
      leaveFamilyPack(params(db, member), at()),
    ]);

    expect(outcomes.filter(({ type }) => type === "updated")).toHaveLength(1);
    expect(
      outcomes.filter(({ type }) => type === "forbidden" || type === "not-found"),
    ).toHaveLength(1);
    await expect(getFamilySeatManagement(params(db, member))).resolves.toEqual({
      type: "no-membership",
    });
    const payerView = await getFamilySeatManagement(params(db, payer));
    expect(payerView).toMatchObject({
      type: "resolved",
      role: "payer",
      seats: expect.arrayContaining([
        expect.objectContaining({ id: issued.seat.id, displayName: null }),
      ]),
    });
    if (payerView.type !== "resolved") throw new Error("payer view was not resolved");
    const terminatedSeat = payerView.seats.find(({ id }) => id === issued.seat.id);
    expect(["left", "removed"]).toContain(terminatedSeat?.status);
    await expect(
      db.query.familySeats.findFirst({
        where: (table, { eq }) => eq(table.id, issued.seat.id),
      }),
    ).resolves.toMatchObject({ memberAccountId: null, invitationId: null });
  });

  it("48時間を過ぎたtokenを失効し、辞退と退出を本人だけに許可する", async () => {
    const db = createTestDb();
    const payer = await account(db, "expiry-payer");
    const member = await account(db, "expiry-member");
    await D1.shared.action.familySeat.createFamilyPack(db, payer);
    const issued = await issueFamilySeatInvitation(params(db, payer), at());
    if (issued.type !== "created") throw new Error("invitation fixture was not created");
    const afterExpiry = new Date("2026-08-18T00:00:00.001Z");
    await expect(
      acceptFamilyInvitation({ ...params(db, member), token: issued.token }, at(afterExpiry)),
    ).resolves.toEqual({ type: "expired" });

    const replacement = await issueFamilySeatInvitation(params(db, payer), at());
    if (replacement.type !== "created") throw new Error("replacement fixture was not created");
    await expect(
      declineFamilyInvitation({ ...params(db, member), token: replacement.token }, at()),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "cancelled" } });

    const joining = await issueFamilySeatInvitation(params(db, payer), at());
    if (joining.type !== "created") throw new Error("joining fixture was not created");
    await acceptFamilyInvitation({ ...params(db, member), token: joining.token }, at());
    await expect(leaveFamilyPack(params(db, payer), at())).resolves.toEqual({
      type: "not-found",
    });
    await expect(leaveFamilyPack(params(db, member), at())).resolves.toMatchObject({
      type: "updated",
      seat: { status: "left" },
    });
  });
});
