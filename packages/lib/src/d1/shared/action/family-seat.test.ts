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
  acceptFamilySeatInvitation,
  activateFamilySeat,
  cancelFamilySeat,
  createFamilyPack,
  createFamilySeatInvitation,
  endFamilyPack,
  leaveFamilySeat,
  readFamilyPackByPayer,
  removeFamilySeat,
  reserveFamilySeat,
} from "./family-seat";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 is used to run D1 migrations in tests.
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      let results: unknown[] = [];
      sqlite.transaction(() => {
        results = queries.map((query) => (query as { run: () => unknown }).run());
      })();
      return results;
    },
  });
  return db as unknown as SharedD1Client;
}

async function account(db: SharedD1Client, name: string): Promise<string> {
  return (await upsertIdentity(db, { provider: "line", providerAccountId: `U_${name}` })).account
    .id;
}

describe("family seat persistence", () => {
  it("支払者を含む4 Accountを上限として招待枠を予約する", async () => {
    const db = createTestDb();
    const payer = await account(db, "payer");
    const pack = await createFamilyPack(db, payer);

    expect(pack.pack.maxSeats).toBe(4);
    expect(pack.seats).toEqual([
      expect.objectContaining({ slotNumber: 1, role: "payer", memberAccountId: payer }),
    ]);
    for (const invitationId of ["invite-1", "invite-2", "invite-3"]) {
      await expect(reserveFamilySeat(db, payer, invitationId)).resolves.toMatchObject({
        type: "updated",
      });
    }
    await expect(reserveFamilySeat(db, payer, "invite-overflow")).resolves.toEqual({
      type: "capacity-reached",
    });

    const current = await readFamilyPackByPayer(db, payer);
    expect(
      current?.seats.filter(({ status }) => ["invited", "active"].includes(status)),
    ).toHaveLength(4);
    expect(new Set(current?.seats.map(({ slotNumber }) => slotNumber))).toEqual(
      new Set([1, 2, 3, 4]),
    );
  });

  it("取消後に空いた枠を再利用し、参加・退出・削除の履歴を残す", async () => {
    const db = createTestDb();
    const payer = await account(db, "lifecycle-payer");
    const member = await account(db, "member");
    await createFamilyPack(db, payer);
    const invitation = await reserveFamilySeat(db, payer, "cancel-me");
    if (invitation.type !== "updated") throw new Error("fixture invitation was not created");
    await expect(cancelFamilySeat(db, invitation.seat.id)).resolves.toMatchObject({
      type: "updated",
      seat: { status: "cancelled" },
    });

    const replacement = await reserveFamilySeat(db, payer, "join-me");
    expect(replacement).toMatchObject({ type: "updated", seat: { slotNumber: 2 } });
    await expect(activateFamilySeat(db, "join-me", member)).resolves.toMatchObject({
      type: "updated",
      seat: { status: "active", memberAccountId: member },
    });
    await expect(leaveFamilySeat(db, member)).resolves.toMatchObject({
      type: "updated",
      seat: { status: "left" },
    });

    const next = await reserveFamilySeat(db, payer, "remove-me");
    if (next.type !== "updated") throw new Error("replacement invitation was not created");
    await activateFamilySeat(db, "remove-me", member);
    await expect(removeFamilySeat(db, next.seat.id)).resolves.toMatchObject({
      type: "updated",
      seat: { status: "removed" },
    });
    const history = await db
      .select()
      .from(schema.familySeats)
      .where(
        eq(
          schema.familySeats.packId,
          replacement.type === "updated" ? replacement.seat.packId : "",
        ),
      )
      .all();
    expect(history.map(({ status }) => status)).toEqual(
      expect.arrayContaining(["active", "cancelled", "left", "removed"]),
    );
  });

  it("契約終了時に招待中・参加中の全席を同時に失効する", async () => {
    const db = createTestDb();
    const payer = await account(db, "ending-payer");
    const member = await account(db, "ending-member");
    await createFamilyPack(db, payer);
    await reserveFamilySeat(db, payer, "accepted");
    await reserveFamilySeat(db, payer, "pending");
    await activateFamilySeat(db, "accepted", member);

    const ended = await endFamilyPack(db, payer);
    expect(ended?.pack.status).toBe("ended");
    expect(ended?.seats.map(({ status }) => status)).toEqual(["ended", "ended", "ended"]);
    await expect(readFamilyPackByPayer(db, payer)).resolves.toBeNull();
  });

  it("並行招待でもlive席は4 Accountを超えずslotが重複しない", async () => {
    const db = createTestDb();
    const payer = await account(db, "parallel-payer");
    await createFamilyPack(db, payer);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => reserveFamilySeat(db, payer, `parallel-${index}`)),
    );

    expect(results.filter(({ type }) => type === "updated")).toHaveLength(3);
    expect(results.filter(({ type }) => type === "capacity-reached")).toHaveLength(5);
    const current = await readFamilyPackByPayer(db, payer);
    const live =
      current?.seats.filter(({ status }) => status === "active" || status === "invited") ?? [];
    expect(live).toHaveLength(4);
    expect(new Set(live.map(({ slotNumber }) => slotNumber)).size).toBe(4);
  });

  it("同じAccountの並行承諾と別パック所属をDB一意制約で拒否する", async () => {
    const db = createTestDb();
    const payerA = await account(db, "payer-a");
    const payerB = await account(db, "payer-b");
    const member = await account(db, "unique-member");
    await createFamilyPack(db, payerA);
    await createFamilyPack(db, payerB);
    await reserveFamilySeat(db, payerA, "race-a");
    await reserveFamilySeat(db, payerB, "race-b");

    const results = await Promise.all([
      activateFamilySeat(db, "race-a", member),
      activateFamilySeat(db, "race-b", member),
    ]);
    expect(results.filter(({ type }) => type === "updated")).toHaveLength(1);
    expect(results.filter(({ type }) => type === "account-already-assigned")).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(schema.familySeats)
          .where(eq(schema.familySeats.memberAccountId, member))
          .all()
      ).filter(({ status }) => status === "active"),
    ).toHaveLength(1);
    await expect(createFamilyPack(db, member)).rejects.toThrow();
  });

  it("一意制約以外のD1エラーを所属競合へ誤変換しない", async () => {
    const db = createTestDb();
    const payer = await account(db, "error-payer");
    const member = await account(db, "error-member");
    await createFamilyPack(db, payer);
    await reserveFamilySeat(db, payer, "error-invitation");
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "update") return Reflect.get(target, property, receiver);
        return () => ({
          set: () => ({
            where: () => ({
              returning: () => ({
                get: () => {
                  throw new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT");
                },
              }),
            }),
          }),
        });
      },
    }) as SharedD1Client;

    await expect(activateFamilySeat(failingDb, "error-invitation", member)).rejects.toThrow(
      "FOREIGN KEY constraint failed",
    );
  });

  it("同じ招待tokenの並行承諾では最初の1 Accountだけを参加させる", async () => {
    const db = createTestDb();
    const payer = await account(db, "token-race-payer");
    const memberA = await account(db, "token-race-a");
    const memberB = await account(db, "token-race-b");
    await createFamilyPack(db, payer);
    await createFamilySeatInvitation(db, {
      payerAccountId: payer,
      tokenHash: "hash-of-single-use-token",
      expiresAt: new Date("2026-08-18T00:00:00.000Z"),
      at: new Date("2026-08-16T00:00:00.000Z"),
    });

    const results = await Promise.all([
      acceptFamilySeatInvitation(
        db,
        "hash-of-single-use-token",
        memberA,
        new Date("2026-08-16T01:00:00.000Z"),
      ),
      acceptFamilySeatInvitation(
        db,
        "hash-of-single-use-token",
        memberB,
        new Date("2026-08-16T01:00:00.000Z"),
      ),
    ]);
    expect(results.filter(({ type }) => type === "updated")).toHaveLength(1);
    expect(results.filter(({ type }) => type === "token-used")).toHaveLength(1);
  });
});
