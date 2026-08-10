import { d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  AvatarConflictSchema,
  AvatarInvalidRequestSchema,
  AvatarNotFoundSchema,
  AvatarRateLimitedSchema,
  AvatarSelectionInvalidRequestSchema,
  AvatarStateResponseSchema,
  SelectAvatarRequestSchema,
} from "../contract/avatar";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import { AvatarImageError } from "../infrastructure/avatar-image";
import {
  cancelAvatarJob,
  deleteAvatar,
  getAvatarImage,
  getAvatarState,
  selectAvatar,
  startAvatarGeneration,
  uploadAvatarSource,
} from "../logic/avatar";
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
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: d1.client.create(c.env.DB as NonNullable<typeof c.env.DB>),
    accountData: c.env.ACCOUNT_DATA as NonNullable<typeof c.env.ACCOUNT_DATA>,
  };
}

function setPollingHeader(
  c: Context<AppEnv>,
  state: v.InferOutput<typeof AvatarStateResponseSchema>,
) {
  if (state.job && ["checking", "verified", "accepted", "generating"].includes(state.job.status)) {
    c.header("Retry-After", "3");
  }
}

export async function getAvatarContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const outcome = await getAvatarState(commonParams(c));
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type !== "resolved") throw new Error("Unexpected avatar state outcome");
  const state = v.parse(AvatarStateResponseSchema, outcome.state);
  setPollingHeader(c, state);
  return c.json(state);
}

export async function postAvatarUpload(c: Context<AppEnv>): Promise<Response> {
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
  if (form.get("consent") !== "true") {
    return c.json(
      v.parse(AvatarInvalidRequestSchema, {
        error: "Invalid avatar request",
        reason: "consent_required",
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
    const outcome = await uploadAvatarSource({
      ...commonParams(c),
      file,
      images: c.env.IMAGES,
      bucket: c.env.AVATAR_BUCKET,
      queue: c.env.AVATAR_QUEUE,
    });
    const auth = authResponse(c, outcome);
    if (auth) return auth;
    if (outcome.type !== "accepted") throw new Error("Unexpected avatar upload outcome");
    const state = v.parse(AvatarStateResponseSchema, outcome.state);
    setPollingHeader(c, state);
    return c.json(state, 202);
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

export async function postAvatarGeneration(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const outcome = await startAvatarGeneration({
    ...commonParams(c),
    jobId: pathParam(c, "jobId"),
    queue: c.env.AVATAR_QUEUE,
  });
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type === "job-not-found") {
    return c.json(v.parse(AvatarNotFoundSchema, { error: "Avatar not found" }), 404);
  }
  if (outcome.type === "invalid-state") {
    return c.json(
      v.parse(AvatarConflictSchema, {
        error: "Avatar state conflict",
        reason: "invalid_job_state",
      }),
      409,
    );
  }
  if (outcome.type === "rate-limited") {
    const retrySeconds = Math.max(
      1,
      Math.ceil((new Date(outcome.retryAt).getTime() - Date.now()) / 1000),
    );
    c.header("Retry-After", String(retrySeconds));
    return c.json(
      v.parse(AvatarRateLimitedSchema, {
        error: "Avatar generation rate limited",
        retryAt: outcome.retryAt,
      }),
      429,
    );
  }
  if (outcome.type !== "accepted") throw new Error("Unexpected generation outcome");
  const state = v.parse(AvatarStateResponseSchema, outcome.state);
  setPollingHeader(c, state);
  return c.json(state, 202);
}

export async function deleteAvatarJob(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const outcome = await cancelAvatarJob({
    ...commonParams(c),
    jobId: pathParam(c, "jobId"),
  });
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type === "job-not-found") {
    return c.json(v.parse(AvatarNotFoundSchema, { error: "Avatar not found" }), 404);
  }
  return c.body(null, 204);
}

export async function putAvatar(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const parsed = v.safeParse(SelectAvatarRequestSchema, await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      v.parse(AvatarSelectionInvalidRequestSchema, {
        error: "Invalid avatar request",
        reason: "candidate_required",
      }),
      400,
    );
  }
  const outcome = await selectAvatar({
    ...commonParams(c),
    candidateId: parsed.output.candidateId,
  });
  const auth = authResponse(c, outcome);
  if (auth) return auth;
  if (outcome.type === "candidate-not-found") {
    return c.json(v.parse(AvatarNotFoundSchema, { error: "Avatar not found" }), 404);
  }
  if (outcome.type === "invalid-state") {
    return c.json(
      v.parse(AvatarConflictSchema, {
        error: "Avatar state conflict",
        reason: "invalid_job_state",
      }),
      409,
    );
  }
  if (outcome.type !== "selected") throw new Error("Unexpected avatar selection outcome");
  return c.json(v.parse(AvatarStateResponseSchema, outcome.state));
}

export async function deleteAvatarContents(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return unavailable(c);
  const outcome = await deleteAvatar(commonParams(c));
  const auth = authResponse(c, outcome);
  if (auth) return auth;
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
