import { D1, type IdentityProvider } from "@me-builder/lib";
import type { SsoIdentityProviderPolicy } from "../../logic/authentication/sso-provider";
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
  policy: SsoIdentityProviderPolicy<IdentityProvider>,
  dependencies: Dependencies = defaultDependencies,
): SsoExistingIdentityResolver {
  return {
    async findAccount(identity) {
      if (identity.providerKey !== policy.activeProviderKey) {
        throw new Error("Unexpected SSO identity provider");
      }
      const found = await dependencies.findAccountByIdentity(
        db,
        policy.activeProviderKey,
        identity.subject,
      );
      return found
        ? {
            accountId: found.account.id,
            authenticatedIdentityId: found.identity.id,
            role: found.account.role,
          }
        : undefined;
    },
  };
}

export function createSsoIdentityLinker(
  db: D1.shared.Client,
  policy: SsoIdentityProviderPolicy<IdentityProvider>,
  dependencies: Dependencies = defaultDependencies,
): SsoIdentityLinker {
  return {
    async link(identity) {
      if (identity.providerKey !== policy.activeProviderKey) {
        throw new Error("Unexpected SSO identity provider");
      }
      const linked = await dependencies.linkIdentity(db, {
        accountId: identity.accountId,
        provider: policy.activeProviderKey,
        providerAccountId: identity.subject,
      });
      return linked.id;
    },
  };
}

/** subjectをresponseへ含めず、本人のIdentity Platform接続状態だけを返す。 */
export async function getSsoIdentityStatus(
  db: D1.shared.Client,
  accountId: string,
  policy: SsoIdentityProviderPolicy<IdentityProvider>,
  dependencies: Dependencies = defaultDependencies,
): Promise<{ linked: boolean; canUnlink: boolean }> {
  const providers = await dependencies.listLoginIdentityProviders(db, accountId);
  return {
    linked: providers.includes(policy.activeProviderKey),
    canUnlink:
      providers.includes(policy.activeProviderKey) &&
      providers.some((provider) => provider !== policy.activeProviderKey),
  };
}

export async function unlinkSsoIdentity(
  db: D1.shared.Client,
  accountId: string,
  policy: SsoIdentityProviderPolicy<IdentityProvider>,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  const providers = await dependencies.listLoginIdentityProviders(db, accountId);
  const hasUsableAlternative = providers.some((provider) => provider !== policy.activeProviderKey);
  if (providers.includes(policy.activeProviderKey) && !hasUsableAlternative) {
    throw new D1.shared.action.account.CannotUnlinkLastIdentityError();
  }
  await dependencies.unlinkIdentity(db, {
    accountId,
    provider: policy.activeProviderKey,
  });
}
