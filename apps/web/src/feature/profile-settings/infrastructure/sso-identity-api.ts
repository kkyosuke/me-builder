import * as v from "valibot";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const SsoIdentityStatusSchema = v.object({
  linked: v.boolean(),
  canUnlink: v.boolean(),
});

export type SsoIdentityStatus = v.InferOutput<typeof SsoIdentityStatusSchema>;

export async function fetchSsoIdentityStatus(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<SsoIdentityStatus> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/auth/sso/identity", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("SSOの接続状態を確認できませんでした。");
  return v.parse(SsoIdentityStatusSchema, await response.json());
}

export function ssoIdentityLinkUrl(apiUrl: string | undefined, returnTo = "/profile"): string {
  const baseUrl = (apiUrl ?? "").replace(/\/$/u, "");
  const query = new URLSearchParams({ returnTo });
  return `${baseUrl}/api/auth/sso/link?${query}`;
}

export async function unlinkSsoIdentity(apiUrl: string | undefined): Promise<void> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/auth/sso/identity", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "最後のログイン方法は解除できません。"
        : "SSOの接続を解除できませんでした。",
    );
  }
}
