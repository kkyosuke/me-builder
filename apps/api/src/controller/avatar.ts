import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  AvatarChangeRateLimitedSchema,
  AvatarInvalidRequestSchema,
  AvatarNotFoundSchema,
  AvatarStateResponseSchema,
} from "../contract/avatar";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { AvatarImageError } from "../infrastructure/avatar-image";
import { deleteAvatar, getAvatarImage, getAvatarState, saveAvatar } from "../logic/avatar";
import type { AppEnv } from "../types";

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.trim().match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

function pathParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

function unavailable(c: Context<AppEnv>): Response {
  logger.error({ path: c.req.path }, "Avatar storage binding is not configured");
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

function authResponse(c: Context<AppEnv>, outcome: { type: string }): Response | null {
  if (outcome.type === "account-not-found") {
    return c.json(
      v.parse(AccountNotFoundErrorSchema, {
        error: "Account not found",
        reason: "friendship_required",
      }),
      404,
    );
  }
  if (outcome.type === "not-configured" || outcome.type === "unauthenticated") {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  return null;
}

function commonParams(c: Context<AppEnv>) {
  const config = getConfig(c.env);
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    avatarChangeIntervalMs: config.avatarChangeIntervalMs,
    db: d1.client.create(c.env.DB as NonNullable<typeof c.env.DB>),
    accountData: c.env.ACCOUNT_DATA as NonNullable<typeof c.env.ACCOUNT_DATA>,
  };
}

function changeRateLimited(c: Context<AppEnv>, retryAt: string): Response {
  const retrySeconds = Math.max(1, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 1000));
  c.header("Retry-After", String(retrySeconds));
  return c.json(
    v.parse(AvatarChangeRateLimitedSchema, {
      error: "Avatar change rate limited",
      retryAt,
    }),
    429,
  );
}

export async function getAvatarContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const outcome = await getAvatarState(commonParams(c));
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type !== "resolved") throw new Error("Unexpected avatar state outcome");
  const state = v.parse(AvatarStateResponseSchema, outcome.state);
  return c.json(state);
}

export async function postAvatarContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.AVATAR_BUCKET || !c.env.IMAGES) {
    return unavailable(c);
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(
      v.parse(AvatarInvalidRequestSchema, {
        error: "Invalid avatar request",
        reason: "image_required",
      }),
      400,
    );
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return c.json(
      v.parse(AvatarInvalidRequestSchema, {
        error: "Invalid avatar request",
        reason: "image_required",
      }),
      400,
    );
  }
  try {
    const outcome = await saveAvatar({
      ...commonParams(c),
      file,
      images: c.env.IMAGES,
      bucket: c.env.AVATAR_BUCKET,
    });
    const auth = authResponse(c, outcome);
    if (auth) return auth;
    if (outcome.type === "rate-limited") return changeRateLimited(c, outcome.retryAt);
    if (outcome.type !== "saved") throw new Error("Unexpected avatar upload outcome");
    return c.json(v.parse(AvatarStateResponseSchema, outcome.state));
  } catch (error) {
    if (error instanceof AvatarImageError) {
      return c.json(
        v.parse(AvatarInvalidRequestSchema, {
          error: "Invalid avatar request",
          reason: error.reason,
        }),
        400,
      );
    }
    throw error;
  }
}

export async function deleteAvatarContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const outcome = await deleteAvatar(commonParams(c));
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type === "rate-limited") return changeRateLimited(c, outcome.retryAt);
  return c.body(null, 204);
}

export async function getAvatarImageContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA || !c.env.AVATAR_BUCKET) return unavailable(c);
  const outcome = await getAvatarImage({
    ...commonParams(c),
    imageId: pathParam(c, "imageId"),
    bucket: c.env.AVATAR_BUCKET,
  });
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type === "image-not-found") {
    return c.json(v.parse(AvatarNotFoundSchema, { error: "Avatar not found" }), 404);
  }
  if (outcome.type !== "resolved-image") throw new Error("Unexpected avatar image outcome");
  return new Response(outcome.body, {
    headers: {
      "Content-Type": outcome.contentType,
      "Cache-Control": "private, no-store",
      ETag: outcome.etag,
    },
  });
}
