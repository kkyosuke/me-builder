import * as v from "valibot";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

const CompatibilitySharePreviewParameterSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  lowLabel: NonEmptyStringSchema,
  highLabel: NonEmptyStringSchema,
  position: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100)),
  statement: NonEmptyStringSchema,
});

/** 相性シートで開示する、生の回答を含まない診断テーマの表示形。 */
export const CompatibilitySharePreviewThemeSchema = v.object({
  diagnosisId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  parameters: v.pipe(v.array(CompatibilitySharePreviewParameterSchema), v.minLength(1)),
});

/** 相性シートで開示する、共有専用projection由来の一人称文章。 */
export const CompatibilityShareProfileSchema = v.object({
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
