import {
  type AccountDataNamespace,
  type AvatarState,
  accountDataFor,
  type d1,
} from "@me-builder/lib";
import { normalizeAvatarImage } from "../infrastructure/avatar-image";
import { createLiffSession } from "./liff-session";

export type PublicAvatarState = {
  currentAvatar: { id: string; imageUrl: string } | null;
};

type AvatarAuthFailure =
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type BaseParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData: AccountDataNamespace;
  avatarChangeIntervalMs: number;
};

type AvatarDependencies = {
  createSession: typeof createLiffSession;
  normalizeImage: typeof normalizeAvatarImage;
  createId: () => string;
};

type AvatarBucket = ApiBindings["AVATAR_BUCKET"];
type AvatarImages = ApiBindings["IMAGES"];

const defaultDependencies: AvatarDependencies = {
  createSession: createLiffSession,
  normalizeImage: normalizeAvatarImage,
  createId: () => crypto.randomUUID(),
};

function publicState(state: AvatarState): PublicAvatarState {
  return {
    currentAvatar: state.currentAvatar
      ? {
          id: state.currentAvatar.id,
          imageUrl: `/api/avatar/images/${state.currentAvatar.id}`,
        }
      : null,
  };
}

async function authenticate(
  params: BaseParams,
  dependencies: AvatarDependencies,
): Promise<{ type: "resolved"; accountId: string } | AvatarAuthFailure> {
  const session = await dependencies.createSession({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return session;
  return { type: "resolved", accountId: session.session.accountId };
}

export async function getAvatarState(
  params: BaseParams,
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<{ type: "resolved"; state: PublicAvatarState } | AvatarAuthFailure> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const state = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.getState",
  );
  return { type: "resolved", state: publicState(state) };
}

export async function saveAvatar(
  params: BaseParams & {
    file: File;
    images: AvatarImages;
    bucket: AvatarBucket;
    at?: Date;
  },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<
  | { type: "saved"; state: PublicAvatarState }
  | { type: "rate-limited"; retryAt: string }
  | AvatarAuthFailure
> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const at = params.at ?? new Date();
  const normalized = await dependencies.normalizeImage(params.file, params.images);
  const imageId = dependencies.createId();
  const objectKey = `accounts/${session.accountId}/avatar/images/${imageId}.webp`;
  await params.bucket.put(objectKey, normalized.bytes, {
    httpMetadata: { contentType: normalized.contentType },
  });

  const object = accountDataFor(params.accountData, session.accountId);
  try {
    const result = await object.execute(
      "avatar.setCurrent",
      { id: imageId, objectKey, contentType: normalized.contentType },
      params.avatarChangeIntervalMs,
      at,
    );
    if (result.type === "rate-limited") {
      await object.execute("avatar.scheduleObjectDeletion", objectKey, at);
      return { type: "rate-limited", retryAt: result.retryAt.toISOString() };
    }
    return { type: "saved", state: publicState(result.state) };
  } catch (error) {
    await object.execute("avatar.scheduleObjectDeletion", objectKey, at).catch(() => undefined);
    throw error;
  }
}

export async function deleteAvatar(
  params: BaseParams & { at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<{ type: "deleted" } | { type: "rate-limited"; retryAt: string } | AvatarAuthFailure> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const result = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.deleteCurrent",
    params.avatarChangeIntervalMs,
    params.at,
  );
  if (result.type === "rate-limited") {
    return { type: "rate-limited", retryAt: result.retryAt.toISOString() };
  }
  return { type: "deleted" };
}

export async function getAvatarImage(
  params: BaseParams & { imageId: string; bucket: AvatarBucket; at?: Date },
  dependencies: AvatarDependencies = defaultDependencies,
): Promise<
  | { type: "resolved-image"; body: ArrayBuffer; contentType: string; etag: string }
  | { type: "image-not-found" }
  | AvatarAuthFailure
> {
  const session = await authenticate(params, dependencies);
  if (session.type !== "resolved") return session;
  const resolved = await accountDataFor(params.accountData, session.accountId).execute(
    "avatar.resolveImage",
    params.imageId,
    params.at,
  );
  if (resolved.type === "not-found") return { type: "image-not-found" };
  const object = await params.bucket.get(resolved.objectKey);
  if (!object) return { type: "image-not-found" };
  return {
    type: "resolved-image",
    body: await object.arrayBuffer(),
    contentType: resolved.contentType,
    etag: object.httpEtag,
  };
}
