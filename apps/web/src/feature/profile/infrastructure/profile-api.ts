import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { ProfileSummaryResult } from "../model/profile-summary";

type ApiResponse = operations["getProfileSummary"]["responses"][200]["content"]["application/json"];

const ResponseSchema = v.object({
  summary: v.nullable(
    v.object({
      generatedAt: v.pipe(v.string(), v.isoTimestamp()),
      headline: v.pipe(v.string(), v.nonEmpty()),
      insights: v.pipe(
        v.array(
          v.object({
            key: v.pipe(v.string(), v.nonEmpty()),
            label: v.pipe(v.string(), v.nonEmpty()),
            description: v.pipe(v.string(), v.nonEmpty()),
            evidenceCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
            sources: v.pipe(v.array(v.picklist(["diagnosis", "diary"])), v.minLength(1)),
          }),
        ),
        v.maxLength(3),
      ),
      recordCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
      diagnosisCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
      diaryCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
      latestRecordedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
    }),
  ),
  nextAction: v.picklist(["diagnosis", "chat"]),
}) satisfies v.GenericSchema<ApiResponse>;

export async function fetchProfileSummary(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<ProfileSummaryResult> {
  const response = await createHttpClient(apiUrl).request("/api/profile-summary", {
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
    throw new Error(`まとめの取得に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(ResponseSchema, await response.json());
}
