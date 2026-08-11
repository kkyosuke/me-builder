import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { ProfileSummaryReadResult } from "../model/profile-summary";

type ApiResponse = operations["getProfileSummary"]["responses"][200]["content"]["application/json"];

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const SummarySchema = v.object({
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
  recordCount: CountSchema,
  diagnosisCount: CountSchema,
  diaryCount: CountSchema,
  latestRecordedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
});

const ResponseSchema = v.object({
  versions: v.array(
    v.object({
      id: v.pipe(v.string(), v.nonEmpty()),
      sequence: v.nullable(v.pipe(CountSchema, v.minValue(1))),
      generatedAt: v.pipe(v.string(), v.isoTimestamp()),
      isLatest: v.boolean(),
      generationMethod: v.picklist(["ai", "deterministic"]),
      summary: SummarySchema,
    }),
  ),
  availableDataCounts: v.object({ diagnosis: CountSchema, diary: CountSchema }),
  generation: v.object({
    status: v.picklist(["idle", "queued", "generating", "failed"]),
    canRegenerate: v.boolean(),
    reasons: v.array(v.picklist(["diagnosis", "brain", "elapsed"])),
    message: v.nullable(v.pipe(v.string(), v.nonEmpty())),
  }),
  nextAction: v.picklist(["diagnosis", "chat"]),
}) satisfies v.GenericSchema<ApiResponse>;

export async function fetchProfileSummary(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<ProfileSummaryReadResult> {
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

  const result = v.parse(ResponseSchema, await response.json());
  const latest = result.versions.find(({ isLatest }) => isLatest) ?? result.versions[0];
  return {
    ...result,
    generation: {
      status: result.generation.status,
      canRegenerate: result.generation.canRegenerate,
      reasons: result.generation.reasons,
      ...(result.generation.message ? { message: result.generation.message } : {}),
    },
    summary: latest?.summary ?? null,
  };
}
