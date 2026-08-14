import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { AvatarInputErrorSchema, ProfileResponseSchema } from "../contract/profile/profile";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { MAX_AVATAR_BYTES, validateAvatarImage } from "../logic/avatar-image";
import {
  type ProfileOutcome,
  authenticateProfile,
  deleteProfileAvatar,
  getProfile,
  saveProfileAvatar,
} from "../logic/profile";
import { getProfileAvatarImage } from "../logic/profile-avatar-image";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";
import { avatarImageResponse } from "./avatar-image-response";

function dependencies(c: Context<AppEnv>) {
  const currentConfig = getConfig(c.env);
  if (!c.env?.DB || !c.env.AVATAR_BUCKET) return undefined;
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: currentConfig.lineLoginChannelId,
    adminLineUserIds: currentConfig.adminLineUserIds,
    db: D1.shared.client.create(c.env.DB),
    avatarBucket: c.env.AVATAR_BUCKET,
  };
}

function unavailable(c: Context<AppEnv>): Response {
  logger.error({ path: c.req.path }, "Profile storage binding is not configured");
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

function profileResponse(c: Context<AppEnv>, outcome: ProfileOutcome): Response {
  switch (outcome.type) {
    case "resolved":
      c.header("Cache-Control", "no-store");
      return c.json(v.parse(ProfileResponseSchema, outcome.profile));
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

async function readAvatarBody(request: Request): Promise<Uint8Array | "too-large"> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_AVATAR_BYTES) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function getProfileContents(c: Context<AppEnv>): Promise<Response> {
  const params = dependencies(c);
  if (!params) return unavailable(c);
  return profileResponse(c, await getProfile(params));
}

export async function getProfileAvatarImageContents(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const params = dependencies(c);
  if (!params) return unavailable(c);
  const outcome = await getProfileAvatarImage({
    ...params,
    lineChannelAccessToken: getConfig(c.env).lineChannelAccessToken,
  });
  switch (outcome.type) {
    case "resolved":
      return avatarImageResponse(outcome.image);
    case "unavailable":
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    case "not-configured":
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}

export async function putProfileAvatar(c: Context<AppEnv>): Promise<Response> {
  const params = dependencies(c);
  if (!params) return unavailable(c);
  const session = await authenticateProfile(params);
  if (session.type !== "resolved") return profileResponse(c, session);

  const declaredLength = Number(c.req.header("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) {
    return c.json(v.parse(AvatarInputErrorSchema, { error: "Avatar image is too large" }), 413);
  }

  const bytes = await readAvatarBody(c.req.raw);
  if (bytes === "too-large") {
    return c.json(v.parse(AvatarInputErrorSchema, { error: "Avatar image is too large" }), 413);
  }
  const validation = validateAvatarImage(bytes, c.req.header("content-type"));
  switch (validation.type) {
    case "empty":
      return c.json(v.parse(AvatarInputErrorSchema, { error: "Avatar image is empty" }), 400);
    case "too-large":
      return c.json(v.parse(AvatarInputErrorSchema, { error: "Avatar image is too large" }), 413);
    case "unsupported":
    case "content-type-mismatch":
      return c.json(v.parse(AvatarInputErrorSchema, { error: "Unsupported avatar image" }), 415);
    case "invalid-size":
      return c.json(
        v.parse(AvatarInputErrorSchema, { error: "Avatar image dimensions are invalid" }),
        422,
      );
    case "valid":
      return profileResponse(
        c,
        await saveProfileAvatar({ ...params, image: validation }, session.session),
      );
  }
}

export async function deleteProfileAvatarContents(c: Context<AppEnv>): Promise<Response> {
  const params = dependencies(c);
  if (!params) return unavailable(c);
  return profileResponse(c, await deleteProfileAvatar(params));
}
