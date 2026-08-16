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
    const verifier = createLineCredentialVerifier(
      "channel-id",
      () => new Date("2026-08-16T00:30:00.000Z"),
    );

    await expect(verifier.verify({ idToken: "secret-token" })).resolves.toMatchObject({
      type: "verified",
      identity: { authenticatedAt: issuedAt },
    });
  });
});
