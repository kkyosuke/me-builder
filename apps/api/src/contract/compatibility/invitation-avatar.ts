import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";
import {
  CompatibilityInvitationUnavailableSchema,
  OwnCompatibilityInvitationSchema,
} from "./invitation-preview";

export const compatibilityInvitationAvatarRoute = describeRoute({
  operationId: "getCompatibilityInvitationAvatar",
  tags: ["Compatibility"],
  summary: "受信者向けに招待送信者のアバター画像を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: {
      description: "招待送信者の現在のアバター画像",
      content: Object.fromEntries(
        ["image/jpeg", "image/png", "image/webp"].map((contentType) => [
          contentType,
          { schema: { type: "string", format: "binary" } },
        ]),
      ),
    },
    204: { description: "表示できるアバター画像がない" },
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    404: jsonResponse(
      "招待または対応するAccountを利用できない",
      v.union([CompatibilityInvitationUnavailableSchema, AccountNotFoundErrorSchema]),
    ),
    409: jsonResponse("送信者本人が自分の招待を開いた", OwnCompatibilityInvitationSchema),
  },
} satisfies DescribeRouteOptions);
