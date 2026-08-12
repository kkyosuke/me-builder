import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { CompatibilitySharePreview } from "../model/compatibility-share-preview";

type ApiResponse =
  operations["getCompatibilitySharePreview"]["responses"][200]["content"]["application/json"];

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
