import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

const ProfileInsightSchema = v.object({
  key: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  evidenceCount: v.pipe(CountSchema, v.minValue(1)),
  sources: v.pipe(v.array(v.picklist(["diagnosis", "diary"])), v.minLength(1)),
});

const ProfileSummarySchema = v.object({
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  headline: NonEmptyStringSchema,
  insights: v.pipe(v.array(ProfileInsightSchema), v.maxLength(3)),
  recordCount: CountSchema,
  diagnosisCount: CountSchema,
  diaryCount: CountSchema,
  latestRecordedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
});

const ProfileSummaryVersionSchema = v.object({
  id: NonEmptyStringSchema,
  sequence: v.nullable(v.pipe(CountSchema, v.minValue(1))),
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  isLatest: v.boolean(),
  generationMethod: v.picklist(["ai", "deterministic"]),
  summary: ProfileSummarySchema,
});

const ProfileSummaryGenerationSchema = v.object({
  status: v.picklist(["idle", "queued", "generating", "failed"]),
  canRegenerate: v.boolean(),
  reasons: v.array(v.picklist(["diagnosis", "brain", "elapsed"])),
  message: v.nullable(NonEmptyStringSchema),
});

export const ProfileSummaryResponseSchema = v.object({
  versions: v.array(ProfileSummaryVersionSchema),
  availableDataCounts: v.object({
    diagnosis: CountSchema,
    diary: CountSchema,
  }),
  generation: ProfileSummaryGenerationSchema,
  nextAction: v.picklist(["diagnosis", "chat"]),
});

export const ProfileSummaryGenerationAcceptedSchema = v.object({
  generationId: NonEmptyStringSchema,
  status: v.picklist(["queued", "generating"]),
  created: v.boolean(),
});

export const ProfileSummaryGenerationUnavailableSchema = v.object({
  error: v.literal("Profile summary generation unavailable"),
  reason: v.picklist(["source_record_required", "regeneration_not_required"]),
});

export const profileSummaryRoute = describeRoute({
  operationId: "getProfileSummary",
  tags: ["Profile"],
  summary: "本人の記録から生成したまとめを取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "本人向けの保存済みまとめ版、現在使えるデータ件数、生成状態と次にできること",
      ProfileSummaryResponseSchema,
    ),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const profileSummaryGenerationRoute = describeRoute({
  operationId: "requestProfileSummaryGeneration",
  tags: ["Profile"],
  summary: "本人の記録から新しいまとめ版のAI生成を要求する",
  security: [{ liffIdToken: [] }],
  responses: {
    202: jsonResponse(
      "生成要求を受け付けた、または処理中の要求を返した",
      ProfileSummaryGenerationAcceptedSchema,
    ),
    409: jsonResponse("生成に利用できる記録がない", ProfileSummaryGenerationUnavailableSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
