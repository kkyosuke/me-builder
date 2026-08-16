import type { R2Bucket } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";
import type { ValidAvatarImage } from "./avatar-image";

type Profile = Readonly<{
  role: "user" | "admin";
  displayName?: string;
  avatar: Readonly<{
    source: "uploaded" | "line";
    url: string;
    updatedAt: string | null;
  }> | null;
}>;

export type ProfileOutcome = { type: "resolved"; profile: Profile };

type Params = Readonly<{
  actor: AuthenticatedActor;
  accountRole: "user" | "admin";
  displayProfile?: Readonly<{ displayName?: string; pictureUrl?: string }>;
  db: D1.shared.Client;
  avatarBucket: R2Bucket;
}>;

type Dependencies = Readonly<{
  createObjectId: () => string;
  getAvatar: typeof D1.shared.action.profile.getProfileAvatar;
  setAvatar: typeof D1.shared.action.profile.setProfileAvatar;
  clearAvatar: typeof D1.shared.action.profile.clearProfileAvatar;
}>;

type ResolvedProfileSession = Readonly<{
  accountId: string;
  role: "user" | "admin";
  displayName?: string;
  pictureUrl?: string;
}>;

const defaultDependencies: Dependencies = {
  createObjectId: () => crypto.randomUUID(),
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

function degradedProfile(
  session: ResolvedProfileSession,
  reason: "object-missing" | "metadata-mismatch",
): ProfileOutcome {
  logger.error(
    { event: "profile.avatar.read.degraded", outcome: "degraded", reason },
    "Profile avatar read degraded to the fallback profile",
  );
  return { type: "resolved", profile: lineProfile(session) };
}

/** PUTが画像bodyを読むより前に本人を確定するための認証境界。 */
export function authenticateProfile(params: Params): ResolvedProfileSession {
  return {
    accountId: params.actor.accountId,
    role: params.accountRole,
    ...(params.displayProfile?.displayName
      ? { displayName: params.displayProfile.displayName }
      : {}),
    ...(params.displayProfile?.pictureUrl ? { pictureUrl: params.displayProfile.pictureUrl } : {}),
  };
}

/** 表示名と現在画像を1応答へまとめ、Private R2のkeyは外へ出さない。 */
export async function getProfile(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileOutcome> {
  const session = authenticateProfile(params);

  const avatar = await dependencies.getAvatar(params.db, session.accountId);
  if (!avatar) return { type: "resolved", profile: lineProfile(session) };

  const object = await params.avatarBucket.get(avatar.objectKey);
  if (!object) return degradedProfile(session, "object-missing");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== avatar.byteSize ||
    object.etag !== avatar.etag ||
    object.httpMetadata?.contentType !== avatar.contentType
  ) {
    return degradedProfile(session, "metadata-mismatch");
  }

  return {
    type: "resolved",
    profile: {
      role: session.role,
      ...(session.displayName ? { displayName: session.displayName } : {}),
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
  const objectKey = `accounts/${session.accountId}/profile/avatar/${dependencies.createObjectId()}.${params.image.extension}`;
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
  const session = authenticateProfile(params);

  const cleared = await dependencies.clearAvatar(params.db, session.accountId);
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
  return { type: "resolved", profile: lineProfile(session) };
}
