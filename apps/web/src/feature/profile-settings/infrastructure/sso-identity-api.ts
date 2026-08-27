import * as v from "valibot";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import { authSessionRuntime } from "../../auth/infrastructure/auth-session-runtime";

const SsoIdentityStatusSchema = v.object({
  linked: v.boolean(),
  canUnlink: v.boolean(),
});

const SsoAuthorizationUrlSchema = v.variant("flow", [
  v.object({
    flow: v.literal("liff-handoff"),
    authorizationUrl: v.pipe(v.string(), v.url()),
    attemptId: v.pipe(v.string(), v.nonEmpty()),
    confirmationSecret: v.pipe(v.string(), v.nonEmpty()),
  }),
  v.object({
    flow: v.literal("same-browser"),
    authorizationUrl: v.pipe(v.string(), v.url()),
  }),
]);
const SsoLinkAttemptStatusSchema = v.object({
  status: v.picklist(["waiting", "ready", "cancelled", "failed", "expired"]),
});

export type SsoIdentityStatus = v.InferOutput<typeof SsoIdentityStatusSchema>;
export type SsoLinkAttemptStatus = v.InferOutput<typeof SsoLinkAttemptStatusSchema>["status"];
export type SsoLinkStart = v.InferOutput<typeof SsoAuthorizationUrlSchema>;

export async function fetchSsoIdentityStatus(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<SsoIdentityStatus> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/auth/sso/identity", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Googleログインの接続状態を確認できませんでした。");
  return v.parse(SsoIdentityStatusSchema, await response.json());
}

export async function startSsoIdentityLink(
  apiUrl: string | undefined,
  returnTo = "/profile",
  handoff: "same-browser" | "liff" = "same-browser",
): Promise<SsoLinkStart> {
  const query = new URLSearchParams({ returnTo });
  if (handoff === "liff") query.set("handoff", "liff");
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/auth/sso/link?${query}`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error("Google連携を開始できませんでした。");
  return v.parse(SsoAuthorizationUrlSchema, await response.json());
}

function confirmationHeaders(secret: string): Headers {
  return new Headers({ "X-SSO-Link-Confirmation": secret });
}

export async function fetchSsoLinkAttemptStatus(
  apiUrl: string | undefined,
  attemptId: string,
  confirmationSecret: string,
): Promise<SsoLinkAttemptStatus> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/auth/sso/link-attempts/${encodeURIComponent(attemptId)}`,
    { headers: confirmationHeaders(confirmationSecret) },
  );
  if (!response.ok) throw new Error("Google認証の状態を確認できませんでした。");
  return v.parse(SsoLinkAttemptStatusSchema, await response.json()).status;
}

export async function confirmSsoLinkAttempt(
  apiUrl: string | undefined,
  attemptId: string,
  confirmationSecret: string,
): Promise<SsoIdentityStatus> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/auth/sso/link-attempts/${encodeURIComponent(attemptId)}/confirmation`,
    { method: "POST", headers: confirmationHeaders(confirmationSecret) },
  );
  if (!response.ok) throw new Error("Google連携を確定できませんでした。もう一度お試しください。");
  const status = v.parse(SsoIdentityStatusSchema, await response.json());
  await authSessionRuntime.synchronizeAfterSessionChange();
  return status;
}

export async function unlinkSsoIdentity(apiUrl: string | undefined): Promise<void> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/auth/sso/identity", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "最後のログイン方法は解除できません。"
        : "Googleログインの接続を解除できませんでした。",
    );
  }
  await authSessionRuntime.synchronizeAfterSessionChange();
}
