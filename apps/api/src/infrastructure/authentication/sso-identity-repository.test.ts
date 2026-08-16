import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import {
  createSsoExistingIdentityResolver,
  createSsoIdentityLinker,
  getSsoIdentityStatus,
  unlinkSsoIdentity,
} from "./sso-identity-repository";

const db = {} as D1.shared.Client;

function dependencies(providers: Array<"line_login" | "auth0"> = []) {
  return {
    findAccountByIdentity: vi.fn(),
    linkIdentity: vi.fn(),
    listLoginIdentityProviders: vi.fn(async () => providers),
    unlinkIdentity: vi.fn(),
  };
}

describe("SSO identity repository adapters", () => {
  it("既知Auth0 IdentityだけをAccount IDへ解決する", async () => {
    const deps = dependencies();
    deps.findAccountByIdentity.mockResolvedValue({ account: { id: "account-1" } });
    const resolver = createSsoExistingIdentityResolver(db, deps as never);

    await expect(
      resolver.findAccountId({ providerKey: "auth0", subject: "auth0|subject" }),
    ).resolves.toBe("account-1");
    expect(deps.findAccountByIdentity).toHaveBeenCalledWith(db, "auth0", "auth0|subject");
  });

  it("未知Identityを作成せずundefinedで返す", async () => {
    const deps = dependencies();
    deps.findAccountByIdentity.mockResolvedValue(undefined);

    await expect(
      createSsoExistingIdentityResolver(db, deps as never).findAccountId({
        providerKey: "auth0",
        subject: "unknown",
      }),
    ).resolves.toBeUndefined();
    expect(deps.linkIdentity).not.toHaveBeenCalled();
  });

  it("開始時のAccountへ検証済みsubjectをlinkIdentityで追加する", async () => {
    const deps = dependencies();

    await createSsoIdentityLinker(db, deps as never).link({
      accountId: "account-1",
      providerKey: "auth0",
      subject: "auth0|subject",
    });

    expect(deps.linkIdentity).toHaveBeenCalledWith(db, {
      accountId: "account-1",
      provider: "auth0",
      providerAccountId: "auth0|subject",
    });
  });

  it("subjectを返さずlink状態と最後のIdentity解除可否だけを返す", async () => {
    const linked = dependencies(["line_login", "auth0"]);
    const only = dependencies(["auth0"]);
    const duplicateOnly = dependencies(["auth0", "auth0"]);

    await expect(getSsoIdentityStatus(db, "account-1", linked as never)).resolves.toEqual({
      linked: true,
      canUnlink: true,
    });
    await expect(getSsoIdentityStatus(db, "account-2", only as never)).resolves.toEqual({
      linked: true,
      canUnlink: false,
    });
    await expect(getSsoIdentityStatus(db, "account-3", duplicateOnly as never)).resolves.toEqual({
      linked: true,
      canUnlink: false,
    });
  });

  it("Auth0だけを解除repositoryへ委譲する", async () => {
    const deps = dependencies(["line_login", "auth0"]);

    await unlinkSsoIdentity(db, "account-1", deps as never);

    expect(deps.unlinkIdentity).toHaveBeenCalledWith(db, {
      accountId: "account-1",
      provider: "auth0",
    });
  });
});
