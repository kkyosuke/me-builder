import { describe, expect, it, vi } from "vitest";
import type { CompatibilityDataNamespace } from "./compatibility-data";
import {
  acceptCompatibilityInvitationWithReferences,
  cancelCompatibilityInvitationWithReference,
  createCompatibilityInvitationWithReference,
  endCompatibilityRelationshipWithReferences,
} from "./compatibility-data-orchestration";
import type { AccountDataNamespace } from "./do/account/rpc";

describe("compatibility data orchestration", () => {
  it("招待正本の作成後に送信者の返事待ち参照を保存する", async () => {
    const createdAt = new Date("2026-08-12T00:00:00.000Z");
    const relationshipId = "1".repeat(64);
    const addReference = vi.fn().mockResolvedValue({});
    const createInvitation = vi.fn().mockResolvedValue({
      outcome: "created",
      relationship: { id: relationshipId, createdAt },
    });
    const accountNamespace = {
      getByName: () => ({ execute: addReference }),
    } as unknown as AccountDataNamespace;
    const compatibilityNamespace = {
      getByName: () => ({ createInvitation }),
    } as unknown as CompatibilityDataNamespace;

    await createCompatibilityInvitationWithReference(
      accountNamespace,
      compatibilityNamespace,
      {
        inviterAccountId: "account-a",
        inviterDisplayName: "送信者",
      },
      relationshipId,
    );

    expect(createInvitation).toHaveBeenCalledWith(
      relationshipId,
      expect.objectContaining({ inviterAccountId: "account-a" }),
    );
    expect(addReference).toHaveBeenCalledWith("account-a", "compatibility.addOutgoingReference", {
      relationshipId,
      createdAt,
    });
  });

  it("送信者参照を保存できなければ発行前の招待を取り消す", async () => {
    const cancelInvitation = vi.fn().mockResolvedValue({ outcome: "cancelled" });
    const accountNamespace = {
      getByName: () => ({ execute: vi.fn().mockRejectedValue(new Error("reference failed")) }),
    } as unknown as AccountDataNamespace;
    const compatibilityNamespace = {
      getByName: () => ({
        createInvitation: vi.fn().mockResolvedValue({
          outcome: "created",
          relationship: { id: "1".repeat(64), createdAt: new Date() },
        }),
        cancelInvitation,
      }),
    } as unknown as CompatibilityDataNamespace;

    await expect(
      createCompatibilityInvitationWithReference(
        accountNamespace,
        compatibilityNamespace,
        {
          inviterAccountId: "account-a",
          inviterDisplayName: "送信者",
        },
        "1".repeat(64),
      ),
    ).rejects.toThrow("reference failed");
    expect(cancelInvitation).toHaveBeenCalledWith("1".repeat(64), "account-a");
  });

  it("予約の保存後にRPC応答が失われても双方へ冪等な解放を試みる", async () => {
    const calls: Array<{ accountId: string; operation: string }> = [];
    const accountNamespace = {
      getByName(accountId: string) {
        return {
          async execute(routedAccountId: string, operation: string) {
            expect(routedAccountId).toBe(accountId);
            calls.push({ accountId, operation });
            if (operation === "compatibility.reserveIncomingReference") {
              // 永続化には成功したものの、応答だけ届かなかった状況を模擬する。
              throw new Error("reservation response lost");
            }
            if (operation === "compatibility.releaseReservation") {
              return { outcome: "released", reference: null };
            }
            return { outcome: "reserved", reference: {} };
          },
        };
      },
    } as unknown as AccountDataNamespace;
    const compatibilityNamespace = {
      getByName() {
        return {
          async getInvitationAcceptanceContext() {
            return {
              inviterAccountId: "account-a",
              expiresAt: new Date("2026-08-23T00:00:00.000Z"),
            };
          },
        };
      },
    } as unknown as CompatibilityDataNamespace;

    await expect(
      acceptCompatibilityInvitationWithReferences(
        accountNamespace,
        compatibilityNamespace,
        "1".repeat(64),
        {
          inviteeAccountId: "account-b",
          inviteeDisplayName: "受信者",
        },
      ),
    ).rejects.toThrow("reservation response lost");
    expect(
      calls.filter(({ operation }) => operation === "compatibility.releaseReservation"),
    ).toEqual([
      { accountId: "account-a", operation: "compatibility.releaseReservation" },
      { accountId: "account-b", operation: "compatibility.releaseReservation" },
    ]);
  });

  it("承諾正本のacceptedAtを双方の有効参照へ投影する", async () => {
    const canonicalAcceptedAt = new Date("2026-08-12T00:15:00.000Z");
    const activationInputs: Array<{ accountId: string; updatedAt: Date }> = [];
    const accountNamespace = {
      getByName(accountId: string) {
        return {
          async execute(routedAccountId: string, operation: string, input: { updatedAt?: Date }) {
            expect(routedAccountId).toBe(accountId);
            if (operation === "compatibility.activateReference" && input.updatedAt) {
              activationInputs.push({ accountId, updatedAt: input.updatedAt });
              return { outcome: "activated", reference: {} };
            }
            return { outcome: "reserved", reference: {} };
          },
        };
      },
    } as unknown as AccountDataNamespace;
    const compatibilityNamespace = {
      getByName: () => ({
        async getInvitationAcceptanceContext() {
          return {
            inviterAccountId: "account-a",
            expiresAt: new Date("2026-08-23T00:00:00.000Z"),
          };
        },
        async acceptInvitation() {
          return {
            outcome: "accepted",
            relationship: {
              inviterAccountId: "account-a",
              inviteeAccountId: "account-b",
              acceptedAt: canonicalAcceptedAt,
            },
          };
        },
      }),
    } as unknown as CompatibilityDataNamespace;

    await acceptCompatibilityInvitationWithReferences(
      accountNamespace,
      compatibilityNamespace,
      "1".repeat(64),
      { inviteeAccountId: "account-b", inviteeDisplayName: "受信者" },
    );

    expect(activationInputs).toEqual([
      { accountId: "account-a", updatedAt: canonicalAcceptedAt },
      { accountId: "account-b", updatedAt: canonicalAcceptedAt },
    ]);
  });

  it("招待の正本を取り消した後に送信者の一覧参照を終了する", async () => {
    const calls: string[] = [];
    const endedAtValues: Date[] = [];
    const canonicalCancelledAt = new Date("2026-08-12T00:30:00.000Z");
    const accountNamespace = {
      getByName: () => ({
        async execute(
          _accountId: string,
          operation: string,
          _relationshipId: string,
          endedAt: Date,
        ) {
          calls.push(operation);
          endedAtValues.push(endedAt);
          return null;
        },
      }),
    } as unknown as AccountDataNamespace;
    const compatibilityNamespace = {
      getByName: () => ({
        async cancelInvitation() {
          calls.push("canonical.cancel");
          return {
            outcome: "cancelled",
            relationship: { inviterAccountId: "account-a", cancelledAt: canonicalCancelledAt },
          };
        },
      }),
    } as unknown as CompatibilityDataNamespace;

    await cancelCompatibilityInvitationWithReference(
      accountNamespace,
      compatibilityNamespace,
      "1".repeat(64),
      "account-a",
    );

    expect(calls).toEqual(["canonical.cancel", "compatibility.endReference"]);
    expect(endedAtValues).toEqual([canonicalCancelledAt]);
  });

  it("相性関係の正本を終了した後に双方の一覧参照を終了する", async () => {
    const calls: string[] = [];
    const endedAtValues: Date[] = [];
    const canonicalEndedAt = new Date("2026-08-12T01:00:00.000Z");
    const accountNamespace = {
      getByName(accountId: string) {
        return {
          async execute(
            routedAccountId: string,
            operation: string,
            _relationshipId: string,
            at: Date,
          ) {
            expect(routedAccountId).toBe(accountId);
            calls.push(`${accountId}.${operation}`);
            endedAtValues.push(at);
            return null;
          },
        };
      },
    } as unknown as AccountDataNamespace;
    const compatibilityNamespace = {
      getByName: () => ({
        async endRelationship() {
          calls.push("canonical.end");
          return {
            outcome: "ended",
            relationship: {
              inviterAccountId: "account-b",
              inviteeAccountId: "account-a",
              endedAt: canonicalEndedAt,
            },
          };
        },
      }),
    } as unknown as CompatibilityDataNamespace;

    await endCompatibilityRelationshipWithReferences(
      accountNamespace,
      compatibilityNamespace,
      "1".repeat(64),
      "account-a",
    );

    expect(calls[0]).toBe("canonical.end");
    expect(new Set(calls.slice(1))).toEqual(
      new Set(["account-a.compatibility.endReference", "account-b.compatibility.endReference"]),
    );
    expect(endedAtValues).toHaveLength(2);
    expect(endedAtValues).toEqual([canonicalEndedAt, canonicalEndedAt]);
  });

  it("正本終了後に片方の参照更新だけ失敗しても再試行で双方を冪等修復する", async () => {
    const attempts = new Map<string, number>();
    const projectionEndedAt = new Map<string, Date>();
    const canonicalEndedAt = new Date("2026-08-12T01:00:00.000Z");
    const accountNamespace = {
      getByName(accountId: string) {
        return {
          async execute(
            _routedAccountId: string,
            _operation: string,
            _relationshipId: string,
            endedAt: Date,
          ) {
            attempts.set(accountId, (attempts.get(accountId) ?? 0) + 1);
            if (accountId === "account-a" && attempts.get(accountId) === 1) {
              throw new Error("account-a unavailable");
            }
            if (!projectionEndedAt.has(accountId)) projectionEndedAt.set(accountId, endedAt);
            return null;
          },
        };
      },
    } as unknown as AccountDataNamespace;
    let canonicalAttempt = 0;
    const relationship = {
      inviterAccountId: "account-a",
      inviteeAccountId: "account-b",
      endedAt: canonicalEndedAt,
    };
    const compatibilityNamespace = {
      getByName: () => ({
        async endRelationship() {
          canonicalAttempt += 1;
          return { outcome: canonicalAttempt === 1 ? "ended" : "unchanged", relationship };
        },
      }),
    } as unknown as CompatibilityDataNamespace;

    await expect(
      endCompatibilityRelationshipWithReferences(
        accountNamespace,
        compatibilityNamespace,
        "1".repeat(64),
        "account-a",
      ),
    ).rejects.toThrow("account-a unavailable");
    await expect(
      endCompatibilityRelationshipWithReferences(
        accountNamespace,
        compatibilityNamespace,
        "1".repeat(64),
        "account-a",
      ),
    ).resolves.toMatchObject({ outcome: "unchanged" });

    expect(attempts).toEqual(
      new Map([
        ["account-a", 2],
        ["account-b", 2],
      ]),
    );
    expect(projectionEndedAt).toEqual(
      new Map([
        ["account-b", canonicalEndedAt],
        ["account-a", canonicalEndedAt],
      ]),
    );
  });
});
