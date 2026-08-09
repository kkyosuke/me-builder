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
  sources: v.pipe(v.array(v.literal("diagnosis")), v.minLength(1)),
});

const ProfileParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  score: v.nullable(v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100))),
  coverage: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  evidenceCount: CountSchema,
  band: v.picklist(["low", "balanced", "high", "insufficient"]),
});

const ProfileThemeSchema = v.object({
  diagnosisId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  answerCount: CountSchema,
  lastAnsweredAt: v.pipe(v.string(), v.isoTimestamp()),
  scoring: v.nullable(
    v.object({
      balancedLabel: NonEmptyStringSchema,
      parameters: v.pipe(v.array(ProfileParameterSchema), v.minLength(1)),
    }),
  ),
});

const ProfileDiaryMemorySchema = v.object({
  id: NonEmptyStringSchema,
  statement: NonEmptyStringSchema,
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  evidenceCount: v.pipe(CountSchema, v.minValue(1)),
});

const ProfileSummarySchema = v.object({
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  headline: NonEmptyStringSchema,
  insights: v.pipe(v.array(ProfileInsightSchema), v.maxLength(3)),
  themes: v.array(ProfileThemeSchema),
  diaryMemories: v.pipe(v.array(ProfileDiaryMemorySchema), v.maxLength(3)),
  recordCount: CountSchema,
  diagnosisCount: CountSchema,
  diaryCount: CountSchema,
  latestRecordedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
});

export const ProfileSummaryResponseSchema = v.object({
  summary: v.nullable(ProfileSummarySchema),
  nextAction: v.nullable(v.literal("diagnosis")),
});

export const profileSummaryRoute = describeRoute({
  operationId: "getProfileSummary",
  tags: ["Profile"],
  summary: "本人の記録から生成したまとめを取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("本人向けのまとめと、次にできること", ProfileSummaryResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
