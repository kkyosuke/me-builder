import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const PreviewTokenSchema = v.pipe(v.string(), v.regex(/^csp2\.[a-f0-9]{64}$/));
const CompatibilitySharePreviewBlockingReasonSchema = v.picklist([
  "display_name_unavailable",
  "profile_summary_required",
  "profile_summary_stale",
  "diagnosis_required",
  "scoring_unavailable",
  "diagnosis_unavailable",
]);

const CompatibilitySharePreviewParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  position: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  statement: NonEmptyStringSchema,
});

const CompatibilitySharePreviewThemeSchema = v.object({
  diagnosisId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  parameters: v.pipe(v.array(CompatibilitySharePreviewParameterSchema), v.minLength(1)),
});

const CompatibilityShareProfileSchema = v.object({
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
});

export const CompatibilitySharePreviewResponseSchema = v.object({
  displayName: v.nullable(NonEmptyStringSchema),
  previewToken: PreviewTokenSchema,
  aboutMe: v.nullable(CompatibilityShareProfileSchema),
  themes: v.array(CompatibilitySharePreviewThemeSchema),
  canIssueInvitation: v.boolean(),
  blockingReasons: v.array(CompatibilitySharePreviewBlockingReasonSchema),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
});

export const compatibilitySharePreviewRoute = describeRoute({
  operationId: "getCompatibilitySharePreview",
  tags: ["Compatibility"],
  summary: "招待発行前に本人が共有内容を確認する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "本人の表示名と、相性診断へ利用できる現在の傾向",
      CompatibilitySharePreviewResponseSchema,
    ),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
