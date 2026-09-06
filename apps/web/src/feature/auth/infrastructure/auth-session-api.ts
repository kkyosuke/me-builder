import * as v from "valibot";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type { ServiceTermsStartupStatus } from "../../../model/web-startup";
import type { AuthDisplayProfile, AuthFailureReason } from "../model/auth-state";

const DisplayProfileSchema = v.object({
  displayName: v.optional(v.string()),
  pictureUrl: v.optional(v.pipe(v.string(), v.url())),
});

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const ServiceTermsStartupStatusSchema = v.object({
  document: v.object({
    version: NonEmptyStringSchema,
    contentHash: v.pipe(v.string(), v.regex(/^sha256:[0-9a-f]{64}$/)),
  }),
  notice: v.nullable(
    v.object({
      type: v.picklist(["important-upcoming", "minor-update"]),
      document: v.object({
        version: NonEmptyStringSchema,
        summary: NonEmptyStringSchema,
      }),
      effectiveAt: v.pipe(v.string(), v.isoTimestamp()),
      displayUntil: v.pipe(v.string(), v.isoTimestamp()),
    }),
  ),
  acceptance: v.object({
    required: v.boolean(),
    acceptedVersion: v.nullable(NonEmptyStringSchema),
    documentHash: v.nullable(v.pipe(v.string(), v.regex(/^sha256:[0-9a-f]{64}$/))),
    acceptedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  }),
}) satisfies v.GenericSchema<ServiceTermsStartupStatus>;

const AuthenticatedSessionSchema = v.object({
  authenticated: v.literal(true),
  displayProfile: v.optional(DisplayProfileSchema),
  role: v.picklist(["user", "admin"]),
  csrfToken: v.pipe(v.string(), v.nonEmpty()),
  terms: v.optional(ServiceTermsStartupStatusSchema),
});

const UnauthenticatedSessionSchema = v.object({
  authenticated: v.literal(false),
  reason: v.optional(
    v.picklist([
      "account-not-found",
      "configuration",
      "credential-rejected",
      "network",
      "session-expired",
      "unknown",
    ] satisfies AuthFailureReason[]),
  ),
});

const SessionResponseSchema = v.variant("authenticated", [
  AuthenticatedSessionSchema,
  UnauthenticatedSessionSchema,
]);

export type AuthSessionResponse =
  | {
      authenticated: true;
      displayProfile?: AuthDisplayProfile | undefined;
      role: "user" | "admin";
      csrfToken: string;
      terms?: ServiceTermsStartupStatus | undefined;
    }
  | { authenticated: false; reason?: AuthFailureReason | undefined };

async function parseSessionResponse(response: Response): Promise<AuthSessionResponse> {
  if (response.status === 401) return { authenticated: false, reason: "session-expired" };
  if (!response.ok) throw new Error(`認証状態を確認できませんでした (HTTP ${response.status})`);
  return v.parse(SessionResponseSchema, await response.json());
}

/** HttpOnly application sessionの現在状態を確認する。 */
export async function fetchAuthSession(
  apiUrl: string | undefined,
  signal: AbortSignal,
): Promise<AuthSessionResponse> {
  const response = await createAuthenticatedHttpClient(apiUrl, globalThis.fetch, {
    authentication: false,
  }).request("/api/auth/session", { signal });
  return parseSessionResponse(response);
}

/** LIFF credentialを一度だけapplication sessionへ交換する。 */
export async function exchangeLiffCredential(
  apiUrl: string | undefined,
  idToken: string,
  signal: AbortSignal,
): Promise<AuthSessionResponse> {
  const response = await createAuthenticatedHttpClient(apiUrl, globalThis.fetch, {
    authentication: false,
  }).request("/api/auth/liff/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    signal,
  });
  return parseSessionResponse(response);
}
