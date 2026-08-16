import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.trim(), v.nonEmpty());
const ChoiceSchema = v.object({ id: NonEmptyStringSchema, label: NonEmptyStringSchema });
const DiagnosisRecordSchema = v.object({
  id: NonEmptyStringSchema,
  kind: v.literal("diagnosis"),
  title: NonEmptyStringSchema,
  value: NonEmptyStringSchema,
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  diagnosisId: NonEmptyStringSchema,
  choices: v.array(ChoiceSchema),
});
const DiaryRecordSchema = v.object({
  id: NonEmptyStringSchema,
  kind: v.literal("diary"),
  title: v.literal("日記"),
  value: NonEmptyStringSchema,
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const PersonalDataRecordsResponseSchema = v.object({
  records: v.array(v.variant("kind", [DiagnosisRecordSchema, DiaryRecordSchema])),
});
export const CorrectPersonalDataRecordRequestSchema = v.variant("kind", [
  v.object({ kind: v.literal("diagnosis"), choiceId: NonEmptyStringSchema }),
  v.object({
    kind: v.literal("diary"),
    value: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(5_000)),
  }),
]);
export const PersonalDataMutationResponseSchema = v.object({
  outcome: v.picklist(["updated", "deleted", "unchanged"]),
  recordId: NonEmptyStringSchema,
  invalidatedBrainItemCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export const PersonalDataRecordNotFoundSchema = v.object({
  error: v.literal("Personal data record not found"),
});
export const InvalidPersonalDataMutationSchema = v.object({
  error: v.literal("Invalid personal data mutation"),
});

const personalDataErrors = {
  ...authenticatedErrors,
  ...currentTermsPolicyError,
  404: jsonResponse("本人が所有する有効な原本がない", PersonalDataRecordNotFoundSchema),
  503: jsonResponse("AccountData bindingが設定されていない", ServiceUnavailableErrorSchema),
};

export const personalDataRecordsRoute = describeRoute({
  operationId: "listPersonalDataRecords",
  tags: ["Personal Data"],
  summary: "本人が訂正・削除できる診断回答と日記を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("現在有効な本人入力", PersonalDataRecordsResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    503: jsonResponse("AccountData bindingが設定されていない", ServiceUnavailableErrorSchema),
  },
} satisfies DescribeRouteOptions);

export const correctPersonalDataRecordRoute = describeRoute({
  operationId: "correctPersonalDataRecord",
  tags: ["Personal Data"],
  summary: "原本を上書きせず新版として訂正する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "diagnosis" },
                choiceId: { type: "string", minLength: 1 },
              },
              required: ["kind", "choiceId"],
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "diary" },
                value: { type: "string", minLength: 1, maxLength: 5_000 },
              },
              required: ["kind", "value"],
            },
          ],
          discriminator: { propertyName: "kind" },
        },
      },
    },
  },
  responses: {
    200: jsonResponse("訂正結果", PersonalDataMutationResponseSchema),
    400: jsonResponse("bodyまたは種別が不正", InvalidPersonalDataMutationSchema),
    422: jsonResponse("診断の選択肢が不正", InvalidPersonalDataMutationSchema),
    ...personalDataErrors,
  },
} satisfies DescribeRouteOptions);

export const deletePersonalDataRecordRoute = describeRoute({
  operationId: "deletePersonalDataRecord",
  tags: ["Personal Data"],
  summary: "原本をtombstoneへ遷移し今後の利用を止める",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    200: jsonResponse("削除受付結果", PersonalDataMutationResponseSchema),
    ...personalDataErrors,
  },
} satisfies DescribeRouteOptions);
