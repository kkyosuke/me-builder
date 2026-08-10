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
