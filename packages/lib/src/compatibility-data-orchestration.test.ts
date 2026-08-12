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
        offeredProfile: {
          profileSummaryVersionId: "profile-version-a",
          fingerprint: "f".repeat(64),
        },
        offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
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
          offeredProfile: {
            profileSummaryVersionId: "profile-version-a",
            fingerprint: "f".repeat(64),
          },
          offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
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
              offeredDiagnosisIds: ["diagnosis-1"],
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
          acceptedProfile: {
            profileSummaryVersionId: "profile-version-b",
            fingerprint: "b".repeat(64),
          },
          acceptedThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
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

  it("招待の正本を取り消した後に送信者の一覧参照を終了する", async () => {
    const calls: string[] = [];
    const accountNamespace = {
      getByName: () => ({
        async execute(_accountId: string, operation: string) {
          calls.push(operation);
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
            relationship: { inviterAccountId: "account-a" },
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
  });

  it("相性関係の正本を終了した後にAccount ID順で双方の一覧参照を終了する", async () => {
    const calls: string[] = [];
    const accountNamespace = {
      getByName(accountId: string) {
        return {
          async execute(routedAccountId: string, operation: string) {
            expect(routedAccountId).toBe(accountId);
            calls.push(`${accountId}.${operation}`);
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

    expect(calls).toEqual([
      "canonical.end",
      "account-a.compatibility.endReference",
      "account-b.compatibility.endReference",
    ]);
  });
});
