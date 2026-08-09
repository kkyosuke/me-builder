import { describe, expect, it } from "vitest";
import type { AccountDataNamespace } from "./account-data";
import type { CompatibilityDataNamespace } from "./compatibility-data";
import { acceptCompatibilityInvitationWithReferences } from "./compatibility-data-orchestration";

describe("compatibility data orchestration", () => {
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
});
