import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import {
  ProfileSummaryGenerationUnavailableError,
  type ProfileSummaryReadResult,
} from "../model/profile-summary";

type ApiResponse = operations["getProfileSummary"]["responses"][200]["content"]["application/json"];
type GenerationResponse =
  operations["requestProfileSummaryGeneration"]["responses"][202]["content"]["application/json"];

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
    reasons: v.array(v.picklist(["diagnosis", "brain", "format", "elapsed"])),
    message: v.nullable(v.pipe(v.string(), v.nonEmpty())),
  }),
  diagnosisThemes: v.array(
    v.object({
      id: v.pipe(v.string(), v.nonEmpty()),
      title: v.pipe(v.string(), v.nonEmpty()),
      lastAnsweredAt: v.pipe(v.string(), v.isoTimestamp()),
      answeredCount: CountSchema,
      questionCount: v.pipe(CountSchema, v.minValue(1)),
      scoring: v.nullable(
        v.object({
          scoringVersion: v.pipe(CountSchema, v.minValue(1)),
          balancedLabel: v.pipe(v.string(), v.nonEmpty()),
          parameters: v.pipe(
            v.array(
              v.object({
                id: v.pipe(v.string(), v.nonEmpty()),
                label: v.pipe(v.string(), v.nonEmpty()),
                lowLabel: v.pipe(v.string(), v.nonEmpty()),
                highLabel: v.pipe(v.string(), v.nonEmpty()),
                score: v.nullable(v.pipe(CountSchema, v.maxValue(100))),
                coverage: v.pipe(CountSchema, v.maxValue(100)),
                band: v.picklist(["low", "balanced", "high", "insufficient"]),
              }),
            ),
            v.minLength(1),
          ),
        }),
      ),
    }),
  ),
  nextAction: v.picklist(["diagnosis", "chat"]),
}) satisfies v.GenericSchema<ApiResponse>;

const GenerationResponseSchema = v.object({
  generationId: v.pipe(v.string(), v.nonEmpty()),
  status: v.picklist(["queued", "generating"]),
  created: v.boolean(),
}) satisfies v.GenericSchema<GenerationResponse>;
const GenerationUnavailableResponseSchema = v.object({
  error: v.literal("Profile summary generation unavailable"),
  reason: v.picklist(["source_record_required", "regeneration_not_required"]),
});

export async function fetchProfileSummary(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<ProfileSummaryReadResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/profile-summary", {
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

export async function requestProfileSummaryGeneration(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<GenerationResponse> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    "/api/profile-summary/generations",
    {
      method: "POST",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    if (response.status === 409) {
      const unavailable = v.safeParse(GenerationUnavailableResponseSchema, await response.json());
      if (unavailable.success) {
        throw new ProfileSummaryGenerationUnavailableError(unavailable.output.reason);
      }
      throw new Error("まとめの生成可否を確認できませんでした。");
    }
    throw new Error(`まとめの生成を開始できませんでした (HTTP ${response.status})`);
  }
  return v.parse(GenerationResponseSchema, await response.json());
}
