import type { R2Bucket } from "@cloudflare/workers-types";
import { D1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { MAX_AVATAR_BYTES } from "./avatar-image";
import { type LiffSessionOutcome, createLiffSession } from "./liff-session";

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProfileAvatarImage = Readonly<{
  bytes: Uint8Array;
  contentType: string;
}>;

type ResolveParams = Readonly<{
  accountId: string;
  verifiedLinePictureUrl?: string | undefined;
  db: D1.shared.Client;
  avatarBucket: R2Bucket;
  lineChannelAccessToken?: string | undefined;
}>;

type ResolveDependencies = Readonly<{
  getAvatar: typeof D1.shared.action.profile.getProfileAvatar;
  findLineIdentity: typeof D1.shared.action.account.findLineIdentityByAccountId;
  getLinePictureUrl: (channelAccessToken: string, lineUserId: string) => Promise<string | null>;
  fetchImage: (url: string) => Promise<Response>;
}>;

const defaultResolveDependencies: ResolveDependencies = {
  getAvatar: D1.shared.action.profile.getProfileAvatar,
  findLineIdentity: D1.shared.action.account.findLineIdentityByAccountId,
  getLinePictureUrl: async (channelAccessToken, lineUserId) => {
    const profile = await line.client.create(channelAccessToken).getProfile(lineUserId);
    return profile.pictureUrl?.trim() || null;
  },
  fetchImage: (url) => fetch(url, { redirect: "follow" }),
};

function contentTypeOf(response: Response): string | null {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType && SUPPORTED_IMAGE_TYPES.has(contentType) ? contentType : null;
}

async function readImageBody(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_AVATAR_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (byteLength === 0) return null;

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function storedAvatarImage(
  params: ResolveParams,
  dependencies: ResolveDependencies,
): Promise<ProfileAvatarImage | null> {
  try {
    const avatar = await dependencies.getAvatar(params.db, params.accountId);
    if (!avatar) return null;
    if (
      avatar.byteSize <= 0 ||
      avatar.byteSize > MAX_AVATAR_BYTES ||
      !SUPPORTED_IMAGE_TYPES.has(avatar.contentType)
    ) {
      logger.warn(
        { event: "profile.avatar.image.read.degraded", reason: "metadata-mismatch" },
        "Profile avatar image read degraded to the LINE profile",
      );
      return null;
    }

    const object = await params.avatarBucket.get(avatar.objectKey);
    if (!object) {
      logger.warn(
        { event: "profile.avatar.image.read.degraded", reason: "object-missing" },
        "Profile avatar image read degraded to the LINE profile",
      );
      return null;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (
      bytes.byteLength !== avatar.byteSize ||
      object.etag !== avatar.etag ||
      object.httpMetadata?.contentType !== avatar.contentType
    ) {
      logger.warn(
        { event: "profile.avatar.image.read.degraded", reason: "metadata-mismatch" },
        "Profile avatar image read degraded to the LINE profile",
      );
      return null;
    }
    return { bytes, contentType: avatar.contentType };
  } catch (error) {
    logger.warn(
      {
        event: "profile.avatar.image.read.degraded",
        reason: "stored-avatar-unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Profile avatar image read degraded to the LINE profile",
    );
    return null;
  }
}

async function lineAvatarImage(
  pictureUrl: string,
  dependencies: ResolveDependencies,
): Promise<ProfileAvatarImage | null> {
  const response = await dependencies.fetchImage(pictureUrl);
  if (!response.ok) return null;
  const contentType = contentTypeOf(response);
  if (!contentType) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) return null;
  const bytes = await readImageBody(response);
  if (!bytes) return null;
  return { bytes, contentType };
}

/** 認可済みAccountについて、設定画像からLINE画像へ安全に縮退して画像bodyを返す。 */
export async function resolveProfileAvatarImage(
  params: ResolveParams,
  dependencies: ResolveDependencies = defaultResolveDependencies,
): Promise<ProfileAvatarImage | null> {
  const stored = await storedAvatarImage(params, dependencies);
  if (stored) return stored;

  try {
    let pictureUrl = params.verifiedLinePictureUrl?.trim() || null;
    if (!pictureUrl && params.lineChannelAccessToken) {
      const lineUserId = await dependencies.findLineIdentity(params.db, params.accountId);
      if (lineUserId) {
        pictureUrl = await dependencies.getLinePictureUrl(
          params.lineChannelAccessToken,
          lineUserId,
        );
      }
    }
    return pictureUrl ? await lineAvatarImage(pictureUrl, dependencies) : null;
  } catch (error) {
    // userId、LINE API response、画像URLはログへ含めない。
    logger.warn(
      {
        event: "profile.avatar.image.line.read.degraded",
        reason: "line-profile-unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Profile avatar image read degraded to the initial fallback",
    );
    return null;
  }
}

type OwnImageParams = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  avatarBucket: R2Bucket;
  lineChannelAccessToken?: string | undefined;
}>;

type OwnImageDependencies = Readonly<{
  createSession: typeof createLiffSession;
  resolveAvatarImage: typeof resolveProfileAvatarImage;
}>;

const defaultOwnImageDependencies: OwnImageDependencies = {
  createSession: createLiffSession,
  resolveAvatarImage: resolveProfileAvatarImage,
};

export type ProfileAvatarImageOutcome =
  | { type: "resolved"; image: ProfileAvatarImage }
  | { type: "unavailable" }
  | Exclude<LiffSessionOutcome, { type: "resolved" }>;

/** LIFF本人の現在のプロフィール画像を、Account IDを入力させずに取得する。 */
export async function getProfileAvatarImage(
  params: OwnImageParams,
  dependencies: OwnImageDependencies = defaultOwnImageDependencies,
): Promise<ProfileAvatarImageOutcome> {
  const session = await dependencies.createSession(params);
  if (session.type !== "resolved") return session;
  const image = await dependencies.resolveAvatarImage({
    accountId: session.session.accountId,
    verifiedLinePictureUrl: session.session.pictureUrl,
    db: params.db,
    avatarBucket: params.avatarBucket,
    lineChannelAccessToken: params.lineChannelAccessToken,
  });
  return image ? { type: "resolved", image } : { type: "unavailable" };
}
