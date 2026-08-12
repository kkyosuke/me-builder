import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { CompatibilityInvitation } from "../model/compatibility-invitation";
import type { CompatibilitySharePreview } from "../model/compatibility-share-preview";

type ApiResponse =
  operations["getCompatibilitySharePreview"]["responses"][200]["content"]["application/json"];
type InvitationApiResponse =
  operations["issueCompatibilityInvitation"]["responses"][201]["content"]["application/json"];
type InvitationApiRequest =
  operations["issueCompatibilityInvitation"]["requestBody"]["content"]["application/json"];

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const ParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  position: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  statement: NonEmptyStringSchema,
});
const ResponseSchema = v.object({
  displayName: v.nullable(NonEmptyStringSchema),
  previewToken: v.pipe(v.string(), v.regex(/^csp2\.[a-f0-9]{64}$/)),
  aboutMe: v.nullable(
    v.object({
      profileSummaryVersionId: NonEmptyStringSchema,
      generatedAt: v.pipe(v.string(), v.isoTimestamp()),
      statements: v.pipe(
        v.array(
          v.object({
            key: NonEmptyStringSchema,
            label: NonEmptyStringSchema,
            statement: NonEmptyStringSchema,
          }),
        ),
        v.minLength(1),
        v.maxLength(3),
      ),
    }),
  ),
  themes: v.array(
    v.object({
      diagnosisId: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
      parameters: v.pipe(v.array(ParameterSchema), v.minLength(1)),
    }),
  ),
  canIssueInvitation: v.boolean(),
  blockingReasons: v.array(
    v.picklist([
      "display_name_unavailable",
      "profile_summary_required",
      "profile_summary_stale",
      "diagnosis_required",
      "scoring_unavailable",
      "diagnosis_unavailable",
    ]),
  ),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
}) satisfies v.GenericSchema<ApiResponse>;

const InvitationResponseSchema = v.object({
  invitationUrl: v.pipe(v.string(), v.url()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
}) satisfies v.GenericSchema<InvitationApiResponse>;

export async function fetchCompatibilitySharePreview(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<CompatibilitySharePreview> {
  const response = await createHttpClient(apiUrl).request("/api/compatibility/share-preview", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw new Error(`共有内容の取得に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(ResponseSchema, await response.json());
}

export async function issueCompatibilityInvitation(
  apiUrl: string | undefined,
  idToken: string,
  previewToken: string,
  signal?: AbortSignal,
): Promise<CompatibilityInvitation> {
  const body: InvitationApiRequest = { previewToken };
  const response = await createHttpClient(apiUrl).request("/api/compatibility/invitations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    if (response.status === 409) {
      throw new Error("共有内容が更新されました。内容を再確認してから発行してください。");
    }
    throw new Error(`招待リンクの発行に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(InvitationResponseSchema, await response.json());
}
