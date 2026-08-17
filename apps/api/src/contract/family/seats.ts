import { type DescribeRouteOptions, describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  ForbiddenErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const FamilySeatSchema = v.object({
  id: v.string(),
  slotNumber: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)),
  role: v.picklist(["payer", "member"]),
  status: v.picklist(["invited", "active", "left", "cancelled", "removed", "ended"]),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const FamilySeatManagementResponseSchema = v.object({
  role: v.picklist(["payer", "member"]),
  maxSeats: v.literal(4),
  seats: v.array(FamilySeatSchema),
});

export const FamilyInvitationResponseSchema = v.object({
  token: v.string(),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  seat: FamilySeatSchema,
});

export const FamilySeatMutationResponseSchema = v.object({ seat: FamilySeatSchema });

const FamilyInvitationTokenRequestSchema = v.object({
  token: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/)),
});

const InvalidFamilyInvitationRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const FamilyOperationUnavailableSchema = v.object({
  error: v.literal("Family operation unavailable"),
  reason: v.picklist([
    "no_membership",
    "capacity_reached",
    "invitation_unavailable",
    "invitation_expired",
    "token_used",
    "account_already_assigned",
  ]),
});

export const familyInvitationTokenValidator = validator(
  "json",
  FamilyInvitationTokenRequestSchema,
  (result, c) =>
    result.success
      ? undefined
      : c.json(v.parse(InvalidFamilyInvitationRequestSchema, { error: "Invalid request" }), 400),
);

const readSecurity = [{ applicationSession: [] }];
const mutationSecurity = [{ applicationSession: [], csrfToken: [] }];
const familyErrors = {
  400: jsonResponse("招待tokenの形式が不正", InvalidFamilyInvitationRequestSchema),
  409: jsonResponse("現在の状態では操作できない", FamilyOperationUnavailableSchema),
  403: jsonResponse("本人に操作権限がない", ForbiddenErrorSchema),
  ...authenticatedErrors,
  ...currentTermsPolicyError,
};

export const familySeatManagementRoute = describeRoute({
  operationId: "getFamilySeatManagement",
  tags: ["Family"],
  summary: "本人が管理または参加しているファミリー席を取得する",
  security: readSecurity,
  responses: {
    200: jsonResponse("個人内容を含まない席状態", FamilySeatManagementResponseSchema),
    ...familyErrors,
  },
} satisfies DescribeRouteOptions);

export const issueFamilyInvitationRoute = describeRoute({
  operationId: "issueFamilyInvitation",
  tags: ["Family"],
  summary: "支払者が48時間有効な1回限りの招待を発行する",
  security: mutationSecurity,
  responses: {
    201: jsonResponse("発行した招待tokenと席", FamilyInvitationResponseSchema),
    ...familyErrors,
  },
} satisfies DescribeRouteOptions);

const mutationRoute = (operationId: string, summary: string) =>
  describeRoute({
    operationId,
    tags: ["Family"],
    summary,
    security: mutationSecurity,
    responses: {
      200: jsonResponse("更新後の席状態", FamilySeatMutationResponseSchema),
      ...familyErrors,
    },
  } satisfies DescribeRouteOptions);

export const acceptFamilyInvitationRoute = mutationRoute(
  "acceptFamilyInvitation",
  "参加者が招待を承諾する",
);
export const declineFamilyInvitationRoute = mutationRoute(
  "declineFamilyInvitation",
  "参加者が招待を辞退する",
);
export const cancelFamilyInvitationRoute = mutationRoute(
  "cancelFamilyInvitation",
  "支払者が招待中の席を取り消す",
);
export const removeFamilyMemberRoute = mutationRoute(
  "removeFamilyMember",
  "支払者が参加者を席から外す",
);
export const leaveFamilyPackRoute = mutationRoute(
  "leaveFamilyPack",
  "参加者がファミリーパックから退出する",
);
