import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  CompatibilityInvitationConflictSchema,
  InvalidCompatibilityInvitationRequestSchema,
  IssueCompatibilityInvitationRequestSchema,
  IssueCompatibilityInvitationResponseSchema,
} from "../contract/compatibility/invitation";
import {
  AcceptCompatibilityInvitationResponseSchema,
  CompatibilityInvitationAcceptanceConflictSchema,
} from "../contract/compatibility/invitation-accept";
import {
  CompatibilityInvitationPreviewResponseSchema,
  CompatibilityInvitationUnavailableSchema,
  OwnCompatibilityInvitationSchema,
} from "../contract/compatibility/invitation-preview";
import {
  CompatibilityRelationshipResponseSchema,
  CompatibilityRelationshipUnavailableSchema,
} from "../contract/compatibility/relationship";
import { CompatibilityRelationshipsResponseSchema } from "../contract/compatibility/relationships";
import {
  CompatibilityShareConsentQuerySchema,
  CompatibilityShareConsentResponseSchema,
  InvalidCompatibilityShareConsentRequestSchema,
} from "../contract/compatibility/share-consent";
import {
  CompatibilityShareContentQuerySchema,
  CompatibilityShareContentResponseSchema,
  InvalidCompatibilityShareContentRequestSchema,
} from "../contract/compatibility/share-content";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { issueCompatibilityInvitation } from "../logic/compatibility-invitation";
import { acceptCompatibilityInvitation } from "../logic/compatibility-invitation-acceptance";
import { getCompatibilityInvitationAvatar } from "../logic/compatibility-invitation-avatar";
import { cancelCompatibilityInvitation } from "../logic/compatibility-invitation-cancellation";
import { getCompatibilityInvitationContents } from "../logic/compatibility-invitation-preview";
import { getCompatibilityRelationshipContents } from "../logic/compatibility-relationship";
import { endCompatibilityRelationship } from "../logic/compatibility-relationship-end";
import { listCompatibilityRelationships } from "../logic/compatibility-relationships";
import {
  getCompatibilityShareConsent,
  getCompatibilityShareContent,
} from "../logic/compatibility-share-preview";
import { operationalHttpPath } from "../operational-http-path";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";
import { avatarImageResponse } from "./avatar-image-response";

/** `GET /api/compatibility/share-consent` — 招待発行前に本人の共有可否を返す。 */
export async function getCompatibilityShareConsentContents(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Compatibility consent storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const parsed = v.safeParse(CompatibilityShareConsentQuerySchema, {
    relationshipCategory: c.req.query("relationshipCategory"),
  });
  if (!parsed.success) {
    return c.json(
      v.parse(InvalidCompatibilityShareConsentRequestSchema, { error: "Invalid request" }),
      400,
    );
  }

  const outcome = await getCompatibilityShareConsent({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    ...(parsed.output.relationshipCategory
      ? { relationshipCategory: parsed.output.relationshipCategory }
      : {}),
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilityShareConsentResponseSchema, outcome.consent));
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/compatibility/share-content` — 本人が開示する現在の内容を返す。 */
export async function getCompatibilityShareContentContents(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Compatibility share content storage is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const parsed = v.safeParse(CompatibilityShareContentQuerySchema, {
    relationshipCategory: c.req.query("relationshipCategory"),
  });
  if (!parsed.success) {
    return c.json(
      v.parse(InvalidCompatibilityShareContentRequestSchema, { error: "Invalid request" }),
      400,
    );
  }

  const outcome = await getCompatibilityShareContent({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    relationshipCategory: parsed.output.relationshipCategory,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilityShareContentResponseSchema, outcome.content));
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `POST /api/compatibility/invitations` — 共有同意から1人用の招待を発行する。 */
export async function postCompatibilityInvitation(c: Context<AppEnv>): Promise<Response> {
  const currentConfig = getConfig(c.env);
  if (
    !c.env?.DB ||
    !c.env.ACCOUNT_DATA ||
    !c.env.COMPATIBILITY_DATA ||
    !currentConfig.liffId ||
    !currentConfig.lineLoginChannelId
  ) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility invitation binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json(
      v.parse(InvalidCompatibilityInvitationRequestSchema, { error: "Invalid request" }),
      400,
    );
  }
  const parsed = v.safeParse(IssueCompatibilityInvitationRequestSchema, input);
  if (!parsed.success) {
    return c.json(
      v.parse(InvalidCompatibilityInvitationRequestSchema, { error: "Invalid request" }),
      400,
    );
  }

  const outcome = await issueCompatibilityInvitation({
    relationshipCategory: parsed.output.relationshipCategory,
    idToken: bearerToken(c.req.header("authorization")),
    liff: {
      liffId: currentConfig.liffId,
      lineLoginChannelId: currentConfig.lineLoginChannelId,
    },
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });

  switch (outcome.type) {
    case "created":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(IssueCompatibilityInvitationResponseSchema, outcome), 201);
    case "share-unavailable":
      return c.json(
        v.parse(CompatibilityInvitationConflictSchema, {
          error: "Compatibility invitation unavailable",
          reason: "share_unavailable",
        }),
        409,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/compatibility/invitations/:relationshipId` — 受信者へ承諾前の確認内容を返す。 */
export async function getCompatibilityInvitation(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility invitation binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const currentConfig = getConfig(c.env);
  const outcome = await getCompatibilityInvitationContents({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: currentConfig.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilityInvitationPreviewResponseSchema, outcome.invitation));
    case "unavailable":
      return c.json(
        v.parse(CompatibilityInvitationUnavailableSchema, {
          error: "Compatibility invitation unavailable",
          reason: "invitation_unavailable",
        }),
        404,
      );
    case "own-invitation":
      return c.json(
        v.parse(OwnCompatibilityInvitationSchema, {
          error: "Compatibility invitation unavailable",
          reason: "own_invitation",
        }),
        409,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/compatibility/invitations/:relationshipId/avatar` — 受信者へ送信者画像を返す。 */
export async function getCompatibilityInvitationAvatarContents(
  c: Context<AppEnv>,
): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.AVATAR_BUCKET || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility invitation avatar binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const currentConfig = getConfig(c.env);
  const outcome = await getCompatibilityInvitationAvatar({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: currentConfig.lineLoginChannelId,
    lineChannelAccessToken: currentConfig.lineChannelAccessToken,
    db: D1.shared.client.create(c.env.DB),
    avatarBucket: c.env.AVATAR_BUCKET,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      return avatarImageResponse(outcome.image);
    case "image-unavailable":
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    case "unavailable":
      return c.json(
        v.parse(CompatibilityInvitationUnavailableSchema, {
          error: "Compatibility invitation unavailable",
          reason: "invitation_unavailable",
        }),
        404,
      );
    case "own-invitation":
      return c.json(
        v.parse(OwnCompatibilityInvitationSchema, {
          error: "Compatibility invitation unavailable",
          reason: "own_invitation",
        }),
        409,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `POST /api/compatibility/invitations/:relationshipId/accept` — 受信者が共有へ同意する。 */
export async function postCompatibilityInvitationAcceptance(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility invitation binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await acceptCompatibilityInvitation({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });

  switch (outcome.type) {
    case "accepted":
      return c.json(
        v.parse(AcceptCompatibilityInvitationResponseSchema, {
          relationshipId: outcome.relationshipId,
          status: "accepted",
        }),
      );
    case "unavailable":
      return c.json(
        v.parse(CompatibilityInvitationUnavailableSchema, {
          error: "Compatibility invitation unavailable",
          reason: "invitation_unavailable",
        }),
        404,
      );
    case "own-invitation":
    case "share-unavailable":
    case "duplicate-relationship":
      return c.json(
        v.parse(CompatibilityInvitationAcceptanceConflictSchema, {
          error: "Compatibility invitation unavailable",
          reason: outcome.type.replaceAll("-", "_"),
        }),
        409,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/compatibility/relationships/:relationshipId` — 現在の相性シートを返す。 */
export async function getCompatibilityRelationship(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility relationship binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await getCompatibilityRelationshipContents({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });
  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilityRelationshipResponseSchema, outcome.relationship));
    case "unavailable":
      return c.json(
        v.parse(CompatibilityRelationshipUnavailableSchema, {
          error: "Compatibility relationship unavailable",
          reason: "relationship_unavailable",
        }),
        404,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `GET /api/compatibility/relationships` — 本人の相性一覧を返す。 */
export async function getCompatibilityRelationships(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const currentConfig = getConfig(c.env);
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA || !currentConfig.liffId) {
    logger.error({ path: c.req.path }, "Compatibility relationship binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await listCompatibilityRelationships({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: currentConfig.lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
    liffId: currentConfig.liffId,
  });
  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilityRelationshipsResponseSchema, { items: outcome.items }));
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `DELETE /api/compatibility/invitations/:relationshipId` — 本人の発行中招待を取り消す。 */
export async function deleteCompatibilityInvitation(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility invitation binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await cancelCompatibilityInvitation({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });
  switch (outcome.type) {
    case "cancelled":
      return c.body(null, 204);
    case "unavailable":
      return c.json(
        v.parse(CompatibilityInvitationUnavailableSchema, {
          error: "Compatibility invitation unavailable",
          reason: "invitation_unavailable",
        }),
        404,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

/** `DELETE /api/compatibility/relationships/:relationshipId` — 当事者の相性関係を終了する。 */
export async function deleteCompatibilityRelationship(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility relationship binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await endCompatibilityRelationship({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });
  switch (outcome.type) {
    case "ended":
      return c.body(null, 204);
    case "unavailable":
      return c.json(
        v.parse(CompatibilityRelationshipUnavailableSchema, {
          error: "Compatibility relationship unavailable",
          reason: "relationship_unavailable",
        }),
        404,
      );
    case "account-not-found":
      return c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      );
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}
