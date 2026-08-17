import * as v from "valibot";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const SsoIdentityStatusSchema = v.object({
  linked: v.boolean(),
  canUnlink: v.boolean(),
});

const SsoAuthorizationUrlSchema = v.object({
  authorizationUrl: v.pipe(v.string(), v.url()),
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

export async function startSsoIdentityLink(
  apiUrl: string | undefined,
  returnTo = "/profile",
): Promise<string> {
  const query = new URLSearchParams({ returnTo });
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/auth/sso/link?${query}`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error("SSOの接続を開始できませんでした。");
  return v.parse(SsoAuthorizationUrlSchema, await response.json()).authorizationUrl;
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
