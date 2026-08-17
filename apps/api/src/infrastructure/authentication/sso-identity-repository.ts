import { D1 } from "@me-builder/lib";
import type {
  SsoExistingIdentityResolver,
  SsoIdentityLinker,
} from "../../logic/authentication/sso-transaction";

type Dependencies = {
  findAccountByIdentity: typeof D1.shared.action.account.findAccountByIdentity;
  linkIdentity: typeof D1.shared.action.account.linkIdentity;
  listLoginIdentityProviders: typeof D1.shared.action.account.listLoginIdentityProviders;
  unlinkIdentity: typeof D1.shared.action.account.unlinkLoginIdentityProvider;
};

const defaultDependencies: Dependencies = {
  findAccountByIdentity: D1.shared.action.account.findAccountByIdentity,
  linkIdentity: D1.shared.action.account.linkIdentity,
  listLoginIdentityProviders: D1.shared.action.account.listLoginIdentityProviders,
  unlinkIdentity: D1.shared.action.account.unlinkLoginIdentityProvider,
};

export function createSsoExistingIdentityResolver(
  db: D1.shared.Client,
  dependencies: Dependencies = defaultDependencies,
): SsoExistingIdentityResolver {
  return {
    async findAccountId(identity) {
      const found = await dependencies.findAccountByIdentity(
        db,
        identity.providerKey,
        identity.subject,
      );
      return found?.account.id;
    },
  };
}

export function createSsoIdentityLinker(
  db: D1.shared.Client,
  dependencies: Dependencies = defaultDependencies,
): SsoIdentityLinker {
  return {
    async link(identity) {
      await dependencies.linkIdentity(db, {
        accountId: identity.accountId,
        provider: identity.providerKey,
        providerAccountId: identity.subject,
      });
    },
  };
}

/** subjectをresponseへ含めず、本人のAuth0接続状態だけを返す。 */
export async function getSsoIdentityStatus(
  db: D1.shared.Client,
  accountId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<{ linked: boolean; canUnlink: boolean }> {
  const providers = await dependencies.listLoginIdentityProviders(db, accountId);
  return {
    linked: providers.includes("auth0"),
    canUnlink: providers.includes("auth0") && providers.some((provider) => provider !== "auth0"),
  };
}

export async function unlinkSsoIdentity(
  db: D1.shared.Client,
  accountId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.unlinkIdentity(db, { accountId, provider: "auth0" });
}
