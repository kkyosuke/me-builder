import { compatibilityRelationshipCategoryValues } from "@me-builder/lib";
import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

export const CompatibilityInvitationPreviewResponseSchema = v.object({
  relationshipCategory: v.picklist(compatibilityRelationshipCategoryValues),
  inviter: v.object({
    displayName: NonEmptyStringSchema,
    avatarUrl: v.nullable(NonEmptyStringSchema),
  }),
  recipient: v.object({
    displayName: v.nullable(NonEmptyStringSchema),
    avatarUrl: v.nullable(NonEmptyStringSchema),
  }),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  canAccept: v.boolean(),
  blockingReasons: v.array(v.picklist(["display_name_unavailable"])),
  nextAction: v.nullable(v.picklist(["diagnosis", "profile-summary"])),
});

export const CompatibilityInvitationUnavailableSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.literal("invitation_unavailable"),
});

export const OwnCompatibilityInvitationSchema = v.object({
  error: v.literal("Compatibility invitation unavailable"),
  reason: v.literal("own_invitation"),
});

export const compatibilityInvitationPreviewRoute = describeRoute({
  operationId: "getCompatibilityInvitation",
  tags: ["Compatibility"],
  summary: "受信者が承諾前に招待者と共有の意味を確認する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse(
      "招待者の表示名と受信者の共有可否",
      CompatibilityInvitationPreviewResponseSchema,
    ),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "招待または対応するAccountを利用できない",
      v.union([CompatibilityInvitationUnavailableSchema, AccountNotFoundErrorSchema]),
    ),
    409: jsonResponse("送信者本人が自分の招待を開いた", OwnCompatibilityInvitationSchema),
  },
} satisfies DescribeRouteOptions);
