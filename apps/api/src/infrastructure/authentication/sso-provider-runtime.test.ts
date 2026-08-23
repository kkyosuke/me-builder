import { describe, expect, it } from "vitest";
import type { ApiConfig } from "../../config";
import {
  createConfiguredSsoProvider,
  isActiveSsoIdentityProvider,
  ssoIdentityProviderPolicy,
} from "./sso-provider-runtime";

const baseConfig = {
  googleIdentityPlatformApiKey: "identity-platform-api-key",
  googleIdentityPlatformTenantId: "development-tenant",
  googleOAuthClientId: "google-client-id",
  googleOAuthClientSecret: "google-client-secret",
  ssoCallbackUrl: "https://api.example.com/api/auth/sso/callback",
} as ApiConfig;

describe("SSO provider composition root", () => {
  it("provider固有設定が揃ったときだけactive adapterを構築する", () => {
    expect(createConfiguredSsoProvider(baseConfig)).toBeDefined();
    expect(
      createConfiguredSsoProvider({
        ...baseConfig,
        googleOAuthClientSecret: undefined,
      }),
    ).toBeUndefined();
  });

  it("active providerの選択をcomposition policyへ閉じ込める", () => {
    expect(ssoIdentityProviderPolicy).toEqual({
      activeProviderKey: "gcp_identity_platform",
    });
    expect(isActiveSsoIdentityProvider("gcp_identity_platform")).toBe(true);
    expect(isActiveSsoIdentityProvider("future_provider")).toBe(false);
  });
});
