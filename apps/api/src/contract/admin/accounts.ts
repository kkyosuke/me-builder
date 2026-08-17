import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ForbiddenErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());
const ProgressionSchema = v.union([
  v.object({ status: v.literal("pending") }),
  v.object({
    status: v.literal("ready"),
    level: v.pipe(CountSchema, v.minValue(1)),
    calculationVersion: v.pipe(CountSchema, v.minValue(1)),
    collectedPieces: CountSchema,
    activePieces: CountSchema,
    lastGrowthAt: v.nullable(TimestampSchema),
    projectedAt: TimestampSchema,
  }),
]);

export const AdminAccountsQuerySchema = v.object({
  query: v.optional(v.pipe(v.string(), v.maxLength(100))),
  role: v.optional(v.picklist(["user", "admin"])),
  status: v.optional(v.literal("active")),
  sort: v.optional(v.picklist(["created", "level", "pieces", "growth"])),
  cursor: v.optional(v.pipe(v.string(), v.nonEmpty(), v.maxLength(512))),
});

export const AdminAccountsResponseSchema = v.object({
  accounts: v.array(
    v.object({
      id: v.pipe(v.string(), v.nonEmpty()),
      displayName: v.nullable(v.pipe(v.string(), v.nonEmpty())),
      role: v.picklist(["user", "admin"]),
      status: v.literal("active"),
      createdAt: TimestampSchema,
      progression: ProgressionSchema,
    }),
  ),
  total: CountSchema,
  nextCursor: v.nullable(v.string()),
});

export const InvalidAdminAccountsRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const adminAccountsRoute = describeRoute({
  operationId: "listAdminAccounts",
  tags: ["Admin"],
  summary: "名前と成長projectionを含むAccount一覧を取得する",
  security: [{ liffIdToken: [] }],
  parameters: [
    { name: "query", in: "query", required: false, schema: { type: "string", maxLength: 100 } },
    {
      name: "role",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["user", "admin"] },
    },
    {
      name: "status",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["active"] },
    },
    {
      name: "sort",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["created", "level", "pieces", "growth"] },
    },
    {
      name: "cursor",
      in: "query",
      required: false,
      schema: { type: "string", maxLength: 512 },
    },
  ],
  responses: {
    200: jsonResponse("管理者向けAccount一覧", AdminAccountsResponseSchema),
    400: jsonResponse("検索条件またはcursorが不正", InvalidAdminAccountsRequestSchema),
    403: jsonResponse("管理者権限がない", ForbiddenErrorSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
