import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  authenticatedErrors,
  csrfValidationError,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

const ProfileInsightSchema = v.object({
  key: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  evidenceCount: v.pipe(CountSchema, v.minValue(1)),
  sources: v.pipe(v.array(v.picklist(["diagnosis", "diary"])), v.minLength(1)),
  selfView: v.nullable(v.literal("not_aligned")),
});

export const ProfileSummaryInsightSelfViewRequestSchema = v.object({
  versionId: NonEmptyStringSchema,
  insightKey: NonEmptyStringSchema,
  selfView: v.nullable(v.literal("not_aligned")),
});

export const ProfileSummaryInsightSelfViewResponseSchema = v.object({ updated: v.literal(true) });
export const ProfileSummaryVersionDeleteResponseSchema = v.object({ deleted: v.literal(true) });

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
  reasons: v.array(v.picklist(["diagnosis", "brain", "format"])),
  message: v.nullable(NonEmptyStringSchema),
});

const ProfileDiagnosisThemeSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  lastAnsweredAt: v.pipe(v.string(), v.isoTimestamp()),
  answeredCount: CountSchema,
  questionCount: v.pipe(CountSchema, v.minValue(1)),
  scoring: v.nullable(
    v.object({
      scoringVersion: v.pipe(CountSchema, v.minValue(1)),
      balancedLabel: NonEmptyStringSchema,
      parameters: v.pipe(
        v.array(
          v.object({
            id: NonEmptyStringSchema,
            label: NonEmptyStringSchema,
            lowLabel: NonEmptyStringSchema,
            highLabel: NonEmptyStringSchema,
            score: v.nullable(v.pipe(CountSchema, v.maxValue(100))),
            coverage: v.pipe(CountSchema, v.maxValue(100)),
            band: v.picklist(["low", "balanced", "high", "insufficient"]),
          }),
        ),
        v.minLength(1),
      ),
    }),
  ),
});

export const ProfileSummaryResponseSchema = v.object({
  versions: v.array(ProfileSummaryVersionSchema),
  availableDataCounts: v.object({
    diagnosis: CountSchema,
    diary: CountSchema,
  }),
  generation: ProfileSummaryGenerationSchema,
  diagnosisThemes: v.array(ProfileDiagnosisThemeSchema),
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
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse(
      "本人向けの保存済みまとめ版、現在使えるデータ件数、生成状態と次にできること",
      ProfileSummaryResponseSchema,
    ),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);

export const profileSummaryGenerationRoute = describeRoute({
  operationId: "requestProfileSummaryGeneration",
  tags: ["Profile"],
  summary: "本人の記録から新しいまとめ版のAI生成を要求する",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    202: jsonResponse(
      "生成要求を受け付けた、または処理中の要求を返した",
      ProfileSummaryGenerationAcceptedSchema,
    ),
    409: jsonResponse(
      "記録不足、再生成不要、または利用上限",
      ProfileSummaryGenerationUnavailableSchema,
    ),
    ...csrfValidationError,
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);

export const profileSummaryInsightSelfViewRoute = describeRoute({
  operationId: "setProfileSummaryInsightSelfView",
  tags: ["Profile"],
  summary: "まとめの見方とは別に本人の見方を保存する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: ProfileSummaryInsightSelfViewRequestSchema } },
  },
  responses: {
    200: jsonResponse("本人の見方を保存した", ProfileSummaryInsightSelfViewResponseSchema),
    ...csrfValidationError,
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);

export const profileSummaryVersionDeleteRoute = describeRoute({
  operationId: "deleteProfileSummaryVersion",
  tags: ["Profile"],
  summary: "本人が指定した保存済みまとめ版を削除する",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    200: jsonResponse("指定したまとめ版を削除した", ProfileSummaryVersionDeleteResponseSchema),
    ...csrfValidationError,
    ...authenticatedErrors,
    404: jsonResponse("本人が所有するまとめ版がない", v.object({ error: v.literal("Not Found") })),
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
