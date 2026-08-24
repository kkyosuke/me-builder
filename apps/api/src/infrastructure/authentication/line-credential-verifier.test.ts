import { line } from "@me-builder/lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLineCredentialVerifier } from "./line-credential-verifier";

describe("createLineCredentialVerifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("検証時刻ではなくIDトークンの発行時刻をauthenticatedAtへ渡す", async () => {
    const issuedAt = new Date("2026-08-16T00:00:00.000Z");
    vi.spyOn(line.idToken, "verify").mockResolvedValue({
      ok: true,
      claims: { sub: "secret-subject", issuedAt },
    });
    const verifier = createLineCredentialVerifier("channel-id");

    await expect(verifier.verify({ idToken: "secret-token" })).resolves.toMatchObject({
      type: "verified",
      identity: { authenticatedAt: issuedAt },
    });
  });

  it("channel ID未設定とLINE検証拒否を固定理由へ変換する", async () => {
    const verify = vi.spyOn(line.idToken, "verify").mockResolvedValue({
      ok: false,
      reason: "signature_invalid",
    });

    await expect(
      createLineCredentialVerifier(undefined).verify({ idToken: "token" }),
    ).resolves.toEqual({ type: "rejected", reason: "authentication_not_configured" });
    expect(verify).not.toHaveBeenCalled();

    await expect(
      createLineCredentialVerifier("channel-id").verify({ idToken: "token" }),
    ).resolves.toEqual({ type: "rejected", reason: "credential_invalid" });
  });

  it("任意の表示情報だけを検証済みIdentityへ含める", async () => {
    vi.spyOn(line.idToken, "verify").mockResolvedValue({
      ok: true,
      claims: {
        sub: "secret-subject",
        issuedAt: new Date("2026-08-16T00:00:00.000Z"),
        name: "表示名",
        picture: "https://example.com/avatar.png",
      },
    });

    await expect(
      createLineCredentialVerifier("channel-id").verify({ idToken: "token" }),
    ).resolves.toMatchObject({
      identity: {
        displayProfile: {
          displayName: "表示名",
          pictureUrl: "https://example.com/avatar.png",
        },
      },
    });
  });
});
