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
  AcceptCompatibilityInvitationRequestSchema,
  AcceptCompatibilityInvitationResponseSchema,
  CompatibilityInvitationAcceptanceConflictSchema,
  InvalidCompatibilityInvitationAcceptanceSchema,
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
import { CompatibilitySharePreviewResponseSchema } from "../contract/compatibility/share-preview";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { issueCompatibilityInvitation } from "../logic/compatibility-invitation";
import { acceptCompatibilityInvitation } from "../logic/compatibility-invitation-acceptance";
import { cancelCompatibilityInvitation } from "../logic/compatibility-invitation-cancellation";
import { getCompatibilityInvitationContents } from "../logic/compatibility-invitation-preview";
import { getCompatibilityRelationshipContents } from "../logic/compatibility-relationship";
import { listCompatibilityRelationships } from "../logic/compatibility-relationships";
import { getCompatibilitySharePreview } from "../logic/compatibility-share-preview";
import { operationalHttpPath } from "../operational-http-path";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

/** `GET /api/compatibility/share-preview` — 招待発行前に本人へ共有内容を表示する。 */
export async function getCompatibilitySharePreviewContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) {
    logger.error({ path: c.req.path }, "Compatibility preview storage binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getCompatibilitySharePreview({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
  });

  switch (outcome.type) {
    case "resolved":
      return c.json(v.parse(CompatibilitySharePreviewResponseSchema, outcome.preview));
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

/** `POST /api/compatibility/invitations` — 確認済み内容から1人用の招待を発行する。 */
export async function postCompatibilityInvitation(c: Context<AppEnv>): Promise<Response> {
  const currentConfig = getConfig(c.env);
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA || !currentConfig.webOrigin) {
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
    idToken: bearerToken(c.req.header("authorization")),
    previewToken: parsed.output.previewToken,
    lineLoginChannelId: currentConfig.lineLoginChannelId,
    webOrigin: currentConfig.webOrigin,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
  });

  switch (outcome.type) {
    case "created":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(IssueCompatibilityInvitationResponseSchema, outcome), 201);
    case "preview-changed":
    case "share-unavailable":
      return c.json(
        v.parse(CompatibilityInvitationConflictSchema, {
          error: "Compatibility invitation unavailable",
          reason: outcome.type === "preview-changed" ? "preview_changed" : "share_unavailable",
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

/** `GET /api/compatibility/invitations/:relationshipId` — 受信者へ同意前の確認内容を返す。 */
export async function getCompatibilityInvitation(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error(
      { path: operationalHttpPath(c.req.path) },
      "Compatibility invitation binding is not configured",
    );
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }

  const outcome = await getCompatibilityInvitationContents({
    relationshipId: c.req.param("relationshipId") ?? "",
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
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

/** `POST /api/compatibility/invitations/:relationshipId/accept` — 確認済み招待を承諾する。 */
export async function postCompatibilityInvitationAcceptance(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
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
      v.parse(InvalidCompatibilityInvitationAcceptanceSchema, { error: "Invalid request" }),
      400,
    );
  }
  const parsed = v.safeParse(AcceptCompatibilityInvitationRequestSchema, input);
  if (!parsed.success) {
    return c.json(
      v.parse(InvalidCompatibilityInvitationAcceptanceSchema, { error: "Invalid request" }),
      400,
    );
  }

  const outcome = await acceptCompatibilityInvitation({
    relationshipId: c.req.param("relationshipId") ?? "",
    previewToken: parsed.output.previewToken,
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
    case "preview-changed":
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

/** `GET /api/compatibility/relationships/:relationshipId` — 同意済み相性シートを返す。 */
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
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.COMPATIBILITY_DATA) {
    logger.error({ path: c.req.path }, "Compatibility relationship binding is not configured");
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await listCompatibilityRelationships({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    accountData: c.env.ACCOUNT_DATA,
    compatibilityData: c.env.COMPATIBILITY_DATA,
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
