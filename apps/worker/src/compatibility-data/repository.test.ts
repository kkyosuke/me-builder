import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CompatibilityDataRepository } from "./repository";

function createRepository() {
  const sqlite = new Database(":memory:");
  const sql = {
    exec<T>(query: string, ...params: unknown[]) {
      if (params.length === 0 && query.includes(";")) {
        sqlite.exec(query);
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      const statement = sqlite.prepare(query);
      const rows = statement.reader ? (statement.all(...params) as T[]) : [];
      const rawRows = statement.reader ? (statement.raw(true).all(...params) as unknown[][]) : [];
      if (!statement.reader) statement.run(...params);
      return {
        toArray: () => rows,
        raw: () => ({ toArray: () => rawRows }),
        one: () => {
          const row = rows[0];
          if (!row) throw new Error("Expected one row");
          return row;
        },
      };
    },
  };
  const storage = {
    sql,
    transactionSync: <T>(callback: () => T) => sqlite.transaction(callback)(),
  } as unknown as DurableObjectStorage;
  return new CompatibilityDataRepository(storage);
}

const createdAt = new Date("2026-08-09T00:00:00.123Z");
const expiresAt = new Date("2026-08-23T00:00:00.123Z");
const relationshipId = "1".repeat(64);

function invitationInput() {
  return {
    inviterAccountId: "account-inviter",
    inviterDisplayName: "送信者",
  } as const;
}

describe("CompatibilityDataRepository", () => {
  it("招待と送信者の同意時刻を作成し、同じ入力を冪等に扱う", async () => {
    const repository = createRepository();
    await repository.initialize();

    expect(repository.createInvitation(relationshipId, invitationInput(), createdAt).outcome).toBe(
      "created",
    );
    const retried = repository.createInvitation(
      relationshipId,
      invitationInput(),
      new Date("2026-08-09T00:01:00.123Z"),
    );

    expect(retried.outcome).toBe("unchanged");
    expect(retried.relationship).toMatchObject({
      id: relationshipId,
      inviterAccountId: "account-inviter",
      inviteeAccountId: null,
      status: "pending",
      createdAt,
      expiresAt,
    });
  });

  it("招待previewへAccount IDと共有内容を含めない", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.createInvitation(relationshipId, invitationInput(), createdAt);

    expect(repository.getInvitationPreview("account-invitee", createdAt)).toEqual({
      id: relationshipId,
      inviterDisplayName: "送信者",
      expiresAt,
      isOwnInvitation: false,
    });
    expect(repository.getInvitationPreview("account-inviter", createdAt)?.isOwnInvitation).toBe(
      true,
    );
  });

  it("送信者本人による承諾を拒否する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.createInvitation(relationshipId, invitationInput(), createdAt);

    expect(
      repository.acceptInvitation(
        { inviteeAccountId: "account-inviter", inviteeDisplayName: "送信者" },
        new Date("2026-08-10T00:00:00.000Z"),
      ).outcome,
    ).toBe("self-invite");
  });

  it("1人だけが承諾でき、参加者だけが参照・終了できる", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.createInvitation(relationshipId, invitationInput(), createdAt);
    const acceptedAt = new Date("2026-08-10T00:00:00.000Z");
    const acceptance = {
      inviteeAccountId: "account-invitee",
      inviteeDisplayName: "受信者",
    } as const;

    expect(repository.acceptInvitation(acceptance, acceptedAt)).toMatchObject({
      outcome: "accepted",
      relationship: {
        inviteeAccountId: "account-invitee",
        inviteeDisplayName: "受信者",
        status: "accepted",
        acceptedAt,
      },
    });
    expect(repository.acceptInvitation(acceptance, acceptedAt).outcome).toBe("unchanged");
    expect(
      repository.acceptInvitation(
        { ...acceptance, inviteeAccountId: "account-another" },
        acceptedAt,
      ).outcome,
    ).toBe("unavailable");
    expect(repository.getRelationship("account-outsider", acceptedAt)).toBeNull();
    expect(repository.getRelationship("account-invitee", acceptedAt)?.status).toBe("accepted");

    const ended = repository.endRelationship(
      "account-inviter",
      new Date("2026-08-11T00:00:00.000Z"),
    );
    expect(ended).toMatchObject({ outcome: "ended", relationship: { status: "ended" } });
    expect(repository.getRelationship("account-invitee", acceptedAt)).toBeNull();
  });

  it("期限到来時に終端化し、期限後の承諾と取消を拒否する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.createInvitation(relationshipId, invitationInput(), createdAt);

    expect(repository.getInvitationPreview("account-invitee", expiresAt)).toBeNull();
    expect(
      repository.acceptInvitation(
        { inviteeAccountId: "account-invitee", inviteeDisplayName: "受信者" },
        expiresAt,
      ).outcome,
    ).toBe("expired");
    expect(repository.cancelInvitation("account-inviter", expiresAt).outcome).toBe("unavailable");
  });
});
