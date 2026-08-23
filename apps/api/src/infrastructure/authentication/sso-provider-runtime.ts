import type { ApiConfig } from "../../config";
import type {
  ExternalSsoProvider,
  SsoIdentityProviderPolicy,
} from "../../logic/authentication/sso-provider";
import {
  GOOGLE_CLOUD_IDENTITY_PLATFORM_PROVIDER_KEY,
  createGoogleCloudIdentityPlatformSsoClient,
} from "./sso-client";

/** 外部SSO製品の選択を閉じ込めるcomposition root。 */
export const ssoIdentityProviderPolicy = {
  activeProviderKey: GOOGLE_CLOUD_IDENTITY_PLATFORM_PROVIDER_KEY,
} as const satisfies SsoIdentityProviderPolicy;

export function createConfiguredSsoProvider(
  configuration: ApiConfig,
): ExternalSsoProvider | undefined {
  if (
    !configuration.googleIdentityPlatformApiKey ||
    !configuration.googleIdentityPlatformTenantId ||
    !configuration.googleOAuthClientId ||
    !configuration.googleOAuthClientSecret ||
    !configuration.ssoCallbackUrl
  ) {
    return undefined;
  }
  return createGoogleCloudIdentityPlatformSsoClient({
    identityPlatformApiKey: configuration.googleIdentityPlatformApiKey,
    identityPlatformTenantId: configuration.googleIdentityPlatformTenantId,
    googleClientId: configuration.googleOAuthClientId,
    googleClientSecret: configuration.googleOAuthClientSecret,
    callbackUrl: configuration.ssoCallbackUrl,
  });
}

export function isActiveSsoIdentityProvider(providerKey: string): boolean {
  return providerKey === ssoIdentityProviderPolicy.activeProviderKey;
}
