import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.trim(), v.nonEmpty());
const PersonalDataExportSchema = v.object({
  id: NonEmptyStringSchema,
  status: v.picklist(["queued", "generating", "ready", "failed", "expired"]),
  requestedAt: v.pipe(v.string(), v.isoTimestamp()),
  completedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  expiresAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  downloadUrl: v.optional(NonEmptyStringSchema),
});
export const PersonalDataExportResponseSchema = v.object({
  outcome: v.optional(v.picklist(["created", "unchanged"])),
  export: PersonalDataExportSchema,
});
export const PersonalDataExportNotFoundSchema = v.object({
  error: v.literal("Personal data export not found"),
});
export const PersonalDataExportNotReadySchema = v.object({
  error: v.literal("Personal data export is not ready"),
});
export const PersonalDataExportExpiredSchema = v.object({
  error: v.literal("Personal data export expired"),
});

const exportErrors = {
  ...authenticatedErrors,
  ...currentTermsPolicyError,
  404: jsonResponse("本人が所有するexport要求がない", PersonalDataExportNotFoundSchema),
  503: jsonResponse("AccountData bindingが設定されていない", ServiceUnavailableErrorSchema),
};

export const requestPersonalDataExportRoute = describeRoute({
  operationId: "requestPersonalDataExport",
  tags: ["Personal Data"],
  summary: "本人データarchiveの非同期生成を要求する",
  security: [{ applicationSession: [], csrfToken: [] }, { liffIdToken: [] }],
  responses: {
    202: jsonResponse("生成要求", PersonalDataExportResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    503: jsonResponse("AccountData bindingが設定されていない", ServiceUnavailableErrorSchema),
  },
} satisfies DescribeRouteOptions);

export const personalDataExportStatusRoute = describeRoute({
  operationId: "getPersonalDataExportStatus",
  tags: ["Personal Data"],
  summary: "本人データarchiveの生成状態と期限を取得する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse("生成状態", PersonalDataExportResponseSchema),
    ...exportErrors,
  },
} satisfies DescribeRouteOptions);

export const downloadPersonalDataExportRoute = describeRoute({
  operationId: "downloadPersonalDataExport",
  tags: ["Personal Data"],
  summary: "期限内の本人データarchiveをdownloadする",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: {
      description: "本人データarchive",
      content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
    },
    409: jsonResponse("生成中または生成失敗", PersonalDataExportNotReadySchema),
    410: jsonResponse("download期限切れ", PersonalDataExportExpiredSchema),
    ...exportErrors,
  },
} satisfies DescribeRouteOptions);
