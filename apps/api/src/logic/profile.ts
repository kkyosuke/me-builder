import type { R2Bucket } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { ValidAvatarImage } from "./avatar-image";
import { type LiffSessionOutcome, createLiffSession } from "./liff-session";

type Profile = Readonly<{
  role: "user" | "admin";
  displayName?: string;
  avatar: Readonly<{
    source: "uploaded" | "line";
    url: string;
    updatedAt: string | null;
  }> | null;
}>;

export type ProfileOutcome =
  | { type: "resolved"; profile: Profile }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  adminLineUserIds?: readonly string[];
  db: D1.shared.Client;
  avatarBucket: R2Bucket;
}>;

type Dependencies = Readonly<{
  createSession: typeof createLiffSession;
  digest: (bytes: Uint8Array) => Promise<string>;
  getAvatar: typeof D1.shared.action.profile.getProfileAvatar;
  setAvatar: typeof D1.shared.action.profile.setProfileAvatar;
  clearAvatar: typeof D1.shared.action.profile.clearProfileAvatar;
}>;

type ResolvedProfileSession = Extract<LiffSessionOutcome, { type: "resolved" }>["session"];

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  digest: sha256,
  getAvatar: D1.shared.action.profile.getProfileAvatar,
  setAvatar: D1.shared.action.profile.setProfileAvatar,
  clearAvatar: D1.shared.action.profile.clearProfileAvatar,
};

function dataUrl(contentType: string, bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function lineProfile(session: {
  role: "user" | "admin";
  displayName?: string | undefined;
  pictureUrl?: string | undefined;
}): Profile {
  return {
    role: session.role,
    ...(session.displayName ? { displayName: session.displayName } : {}),
    avatar: session.pictureUrl
      ? { source: "line", url: session.pictureUrl, updatedAt: null }
      : null,
  };
}

async function resolveSession(params: Params, dependencies: Dependencies) {
  return dependencies.createSession({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
    ...(params.adminLineUserIds ? { adminLineUserIds: params.adminLineUserIds } : {}),
  });
}

/** PUTが画像bodyを読むより前に本人を確定するための認証境界。 */
export async function authenticateProfile(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<LiffSessionOutcome> {
  return resolveSession(params, dependencies);
}

/** 表示名と現在画像を1応答へまとめ、Private R2のkeyは外へ出さない。 */
export async function getProfile(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileOutcome> {
  const session = await authenticateProfile(params, dependencies);
  if (session.type !== "resolved") return session;

  const avatar = await dependencies.getAvatar(params.db, session.session.accountId);
  if (!avatar) return { type: "resolved", profile: lineProfile(session.session) };

  const object = await params.avatarBucket.get(avatar.objectKey);
  if (!object) throw new Error("Profile avatar metadata references a missing object");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== avatar.byteSize ||
    object.etag !== avatar.etag ||
    object.httpMetadata?.contentType !== avatar.contentType
  ) {
    throw new Error("Profile avatar metadata does not match the stored object");
  }

  return {
    type: "resolved",
    profile: {
      role: session.session.role,
      ...(session.session.displayName ? { displayName: session.session.displayName } : {}),
      avatar: {
        source: "uploaded",
        url: dataUrl(avatar.contentType, bytes),
        updatedAt: avatar.updatedAt.toISOString(),
      },
    },
  };
}

/** R2へ画像を保存してから、共有D1のAccount設定を切り替える。 */
export async function saveProfileAvatar(
  params: Params & Readonly<{ image: ValidAvatarImage; at?: Date }>,
  session: ResolvedProfileSession,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileOutcome> {
  const digest = await dependencies.digest(params.image.bytes);
  const objectKey = `accounts/${session.accountId}/profile/avatar/${digest}.${params.image.extension}`;
  const stored = await params.avatarBucket.put(objectKey, params.image.bytes, {
    httpMetadata: { contentType: params.image.contentType },
  });

  const updatedAt = params.at ?? new Date();
  const updated = await dependencies
    .setAvatar(params.db, session.accountId, {
      objectKey,
      contentType: params.image.contentType,
      byteSize: params.image.bytes.byteLength,
      etag: stored.etag,
      updatedAt,
    })
    .catch(async (error: unknown) => {
      let shouldRemoveUnreferencedObject = false;
      try {
        const current = await dependencies.getAvatar(params.db, session.accountId);
        shouldRemoveUnreferencedObject = current?.objectKey !== objectKey;
      } catch {
        logger.error(
          { event: "profile.avatar.rollback.reference-check.failed", outcome: "failed" },
          "Profile avatar reference could not be checked after metadata update failure",
        );
      }
      if (shouldRemoveUnreferencedObject) {
        try {
          await params.avatarBucket.delete(objectKey);
        } catch {
          logger.error(
            { event: "profile.avatar.rollback.failed", outcome: "failed" },
            "New profile avatar could not be removed after metadata update failure",
          );
        }
      }
      throw error;
    });

  if (updated.previousObjectKey && updated.previousObjectKey !== objectKey) {
    try {
      await params.avatarBucket.delete(updated.previousObjectKey);
    } catch {
      logger.error(
        { event: "profile.avatar.cleanup.failed", outcome: "failed" },
        "Old profile avatar could not be removed after replacement",
      );
    }
  }

  return {
    type: "resolved",
    profile: {
      role: session.role,
      ...(session.displayName ? { displayName: session.displayName } : {}),
      avatar: {
        source: "uploaded",
        url: dataUrl(params.image.contentType, params.image.bytes),
        updatedAt: updated.avatar.updatedAt.toISOString(),
      },
    },
  };
}

/** 保存画像を現在値から外し、表示を検証済みLINEプロフィールへ戻す。 */
export async function deleteProfileAvatar(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileOutcome> {
  const session = await authenticateProfile(params, dependencies);
  if (session.type !== "resolved") return session;

  const cleared = await dependencies.clearAvatar(params.db, session.session.accountId);
  if (cleared.previousObjectKey) {
    try {
      await params.avatarBucket.delete(cleared.previousObjectKey);
    } catch {
      logger.error(
        { event: "profile.avatar.cleanup.failed", outcome: "failed" },
        "Profile avatar could not be removed after metadata deletion",
      );
    }
  }
  return { type: "resolved", profile: lineProfile(session.session) };
}
