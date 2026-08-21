import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import {
  createSsoExistingIdentityResolver,
  createSsoIdentityLinker,
  getSsoIdentityStatus,
  unlinkSsoIdentity,
} from "./sso-identity-repository";

const db = {} as D1.shared.Client;
type Provider = "line_login" | "gcp_identity_platform";
const policy = {
  activeProviderKey: "gcp_identity_platform",
} as const;

function dependencies(providers: Provider[] = []) {
  return {
    findAccountByIdentity: vi.fn(),
    linkIdentity: vi.fn(),
    listLoginIdentityProviders: vi.fn(async () => providers),
    unlinkIdentity: vi.fn(),
  };
}

describe("SSO identity repository adapters", () => {
  it("既知Identity Platform Identityだけを段階公開判定用のAccountとIdentity IDへ解決する", async () => {
    const deps = dependencies();
    deps.findAccountByIdentity.mockResolvedValue({
      account: { id: "account-1", role: "admin" },
      identity: { id: "identity-google" },
    });
    const resolver = createSsoExistingIdentityResolver(db, policy, deps as never);

    await expect(
      resolver.findAccount({
        providerKey: "gcp_identity_platform",
        subject: "identity-platform-uid",
      }),
    ).resolves.toEqual({
      accountId: "account-1",
      authenticatedIdentityId: "identity-google",
      role: "admin",
    });
    expect(deps.findAccountByIdentity).toHaveBeenCalledWith(
      db,
      "gcp_identity_platform",
      "identity-platform-uid",
    );
  });

  it("未知Identityを作成せずundefinedで返す", async () => {
    const deps = dependencies();
    deps.findAccountByIdentity.mockResolvedValue(undefined);

    await expect(
      createSsoExistingIdentityResolver(db, policy, deps as never).findAccount({
        providerKey: "gcp_identity_platform",
        subject: "unknown",
      }),
    ).resolves.toBeUndefined();
    expect(deps.linkIdentity).not.toHaveBeenCalled();
  });

  it("composition policyと異なるproviderをD1境界へ渡さない", async () => {
    const deps = dependencies();

    await expect(
      createSsoExistingIdentityResolver(db, policy, deps as never).findAccount({
        providerKey: "future_provider",
        subject: "unexpected-subject",
      }),
    ).rejects.toThrow("Unexpected SSO identity provider");
    expect(deps.findAccountByIdentity).not.toHaveBeenCalled();
  });

  it("開始時のAccountへ検証済みlocalIdをlinkIdentityで追加する", async () => {
    const deps = dependencies();
    deps.linkIdentity.mockResolvedValue({ id: "identity-google" });

    await expect(
      createSsoIdentityLinker(db, policy, deps as never).link({
        accountId: "account-1",
        providerKey: "gcp_identity_platform",
        subject: "identity-platform-uid",
      }),
    ).resolves.toBe("identity-google");

    expect(deps.linkIdentity).toHaveBeenCalledWith(db, {
      accountId: "account-1",
      provider: "gcp_identity_platform",
      providerAccountId: "identity-platform-uid",
    });
  });

  it("subjectを返さずlink状態と最後のIdentity解除可否だけを返す", async () => {
    const linked = dependencies(["line_login", "gcp_identity_platform"]);
    const only = dependencies(["gcp_identity_platform"]);

    await expect(getSsoIdentityStatus(db, "account-1", policy, linked as never)).resolves.toEqual({
      linked: true,
      canUnlink: true,
    });
    await expect(getSsoIdentityStatus(db, "account-2", policy, only as never)).resolves.toEqual({
      linked: true,
      canUnlink: false,
    });
  });

  it("Identity Platform Identityだけを解除repositoryへ委譲する", async () => {
    const deps = dependencies(["line_login", "gcp_identity_platform"]);

    await unlinkSsoIdentity(db, "account-1", policy, deps as never);

    expect(deps.unlinkIdentity).toHaveBeenCalledWith(db, {
      accountId: "account-1",
      provider: "gcp_identity_platform",
    });
  });
});
