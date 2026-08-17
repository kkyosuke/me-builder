import { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { authenticateLiff } from "./authenticate-liff";
import type { CredentialVerifier } from "./types";

describe("authenticateLiff", () => {
  it("検証済みIdentityをLINE固有情報のないactorへ変換する", async () => {
    const verifier: CredentialVerifier<{ idToken: string }> = {
      verify: vi.fn().mockResolvedValue({
        type: "verified",
        identity: {
          providerKey: "line_login",
          subject: "secret-subject",
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
          displayProfile: { displayName: "うつし" },
        },
      }),
    };
    const resolveAccountByLineLogin = vi
      .spyOn(D1.shared.action.account, "resolveAccountByLineLogin")
      .mockResolvedValue({
        account: { id: "account-1", role: "user" },
      } as never);
    vi.spyOn(D1.shared.action.profile, "saveVerifiedDisplayName").mockResolvedValue(undefined);

    const result = await authenticateLiff({
      idToken: "secret-token",
      db: {} as D1.shared.Client,
      verifier,
    });

    expect(result).toEqual({
      type: "authenticated",
      actor: {
        accountId: "account-1",
        authenticationMethod: "liff",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      },
      accountRole: "user",
      displayProfile: { displayName: "うつし" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-subject");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(resolveAccountByLineLogin).toHaveBeenCalledWith(
      expect.anything(),
      "secret-subject",
      "user",
    );
  });
});
