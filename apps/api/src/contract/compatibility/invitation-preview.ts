import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";
import {
  CompatibilitySharePreviewThemeSchema,
  CompatibilityShareProfileSchema,
} from "./share-preview";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const PreviewTokenSchema = v.pipe(v.string(), v.regex(/^csp2\.[a-f0-9]{64}$/));

export const CompatibilityInvitationPreviewResponseSchema = v.object({
  inviter: v.object({
    displayName: NonEmptyStringSchema,
    aboutMe: CompatibilityShareProfileSchema,
    themes: v.pipe(v.array(CompatibilitySharePreviewThemeSchema), v.minLength(1)),
  }),
  recipient: v.object({
    displayName: v.nullable(NonEmptyStringSchema),
    previewToken: PreviewTokenSchema,
    aboutMe: v.nullable(CompatibilityShareProfileSchema),
    themes: v.array(CompatibilitySharePreviewThemeSchema),
  }),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
  canAccept: v.boolean(),
  blockingReasons: v.array(
    v.picklist([
      "display_name_unavailable",
      "profile_summary_required",
      "profile_summary_stale",
      "diagnosis_required",
      "scoring_unavailable",
      "diagnosis_unavailable",
      "common_diagnosis_required",
    ]),
  ),
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
  summary: "受信者が承諾前に双方の共有内容を確認する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "招待者の同意済み内容と受信者の現在内容",
      CompatibilityInvitationPreviewResponseSchema,
    ),
    ...authenticatedErrors,
    404: jsonResponse(
      "招待または対応するAccountを利用できない",
      v.union([CompatibilityInvitationUnavailableSchema, AccountNotFoundErrorSchema]),
    ),
    409: jsonResponse("送信者本人が自分の招待を開いた", OwnCompatibilityInvitationSchema),
  },
} satisfies DescribeRouteOptions);
