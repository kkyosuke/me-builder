import {
  WEB_CLIENT_ERROR_KINDS,
  WEB_CLIENT_ERROR_TYPES,
  WEB_CLIENT_OPERATIONS,
  WEB_CLIENT_OPERATION_ERROR_CODES,
  WEB_CLIENT_ROUTES,
} from "@me-builder/shared";
import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ForbiddenErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const webClientErrorReportEntries = {
  schemaVersion: v.literal(1),
  kind: v.picklist(WEB_CLIENT_ERROR_KINDS),
  route: v.picklist(WEB_CLIENT_ROUTES),
  release: v.pipe(v.string(), v.regex(/^(?:development|[a-f0-9]{7,40})$/), v.maxLength(40)),
  errorType: v.picklist(WEB_CLIENT_ERROR_TYPES),
  sourceFile: v.optional(
    v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+\.(?:js|mjs)$/), v.maxLength(120)),
  ),
  sourceLine: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(10_000_000)),
  ),
  sourceColumn: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(10_000_000)),
  ),
  operation: v.optional(v.picklist(WEB_CLIENT_OPERATIONS)),
  operationErrorCode: v.optional(v.picklist(WEB_CLIENT_OPERATION_ERROR_CODES)),
  operationStatus: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(400), v.maxValue(599)),
  ),
  online: v.boolean(),
  recovered: v.boolean(),
} as const;

/** runtimeではallowlist外のフィールドと、操作エラー以外への操作情報の混入を受理しない。 */
export const WebClientErrorReportSchema = v.pipe(
  v.strictObject(webClientErrorReportEntries),
  v.check((report) =>
    report.kind === "handled-operation-error"
      ? report.operation !== undefined && report.operationErrorCode !== undefined
      : report.operation === undefined &&
        report.operationErrorCode === undefined &&
        report.operationStatus === undefined,
  ),
);
const WebClientErrorReportDocumentationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "route",
    "release",
    "errorType",
    "online",
    "recovered",
  ] as string[],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { type: "string", enum: [...WEB_CLIENT_ERROR_KINDS] as string[] },
    route: { type: "string", enum: [...WEB_CLIENT_ROUTES] as string[] },
    release: { type: "string", pattern: "^(?:development|[a-f0-9]{7,40})$", maxLength: 40 },
    errorType: { type: "string", enum: [...WEB_CLIENT_ERROR_TYPES] as string[] },
    sourceFile: {
      type: "string",
      pattern: "^[A-Za-z0-9_-]+\\.(?:js|mjs)$",
      maxLength: 120,
    },
    sourceLine: { type: "integer", minimum: 1, maximum: 10_000_000 },
    sourceColumn: { type: "integer", minimum: 1, maximum: 10_000_000 },
    operation: { type: "string", enum: [...WEB_CLIENT_OPERATIONS] as string[] },
    operationErrorCode: {
      type: "string",
      enum: [...WEB_CLIENT_OPERATION_ERROR_CODES] as string[],
    },
    operationStatus: { type: "integer", minimum: 400, maximum: 599 },
    online: { type: "boolean" },
    recovered: { type: "boolean" },
  },
} as const;

export const webClientErrorReportRoute = describeRoute({
  operationId: "reportWebClientError",
  tags: ["Observability"],
  summary: "Web UIの安全化済み未捕捉・操作エラーをWorkers Logsへ記録する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: WebClientErrorReportDocumentationSchema } },
  },
  responses: {
    204: { description: "ブラウザエラーを受理した" },
    400: { description: "request bodyが固定schemaと一致しない" },
    403: jsonResponse("OriginまたはCSRF tokenが一致しない", ForbiddenErrorSchema),
    413: { description: "request bodyが上限を超えている" },
    429: { description: "ブラウザエラー受付の流量上限を超えた" },
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
