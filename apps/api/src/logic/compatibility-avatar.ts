import type { R2Bucket } from "@cloudflare/workers-types";
import { D1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";

type Params = Readonly<{
  accountId: string;
  verifiedLinePictureUrl?: string | undefined;
  db: D1.shared.Client;
  avatarBucket?: R2Bucket | undefined;
  lineChannelAccessToken?: string | undefined;
}>;

type Dependencies = Readonly<{
  getAvatar: typeof D1.shared.action.profile.getProfileAvatar;
  findLineIdentity: typeof D1.shared.action.account.findLineIdentityByAccountId;
  getLinePictureUrl: (channelAccessToken: string, lineUserId: string) => Promise<string | null>;
}>;

const defaultDependencies: Dependencies = {
  getAvatar: D1.shared.action.profile.getProfileAvatar,
  findLineIdentity: D1.shared.action.account.findLineIdentityByAccountId,
  getLinePictureUrl: async (channelAccessToken, lineUserId) => {
    const profile = await line.client.create(channelAccessToken).getProfile(lineUserId);
    return profile.pictureUrl?.trim() || null;
  },
};

function dataUrl(contentType: string, bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function storedAvatarUrl(params: Params, dependencies: Dependencies): Promise<string | null> {
  try {
    const avatar = await dependencies.getAvatar(params.db, params.accountId);
    if (!avatar || !params.avatarBucket) return null;

    const object = await params.avatarBucket.get(avatar.objectKey);
    if (!object) {
      logger.warn(
        { event: "compatibility.avatar.read.degraded", reason: "object-missing" },
        "Compatibility avatar read degraded to the LINE profile",
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
        { event: "compatibility.avatar.read.degraded", reason: "metadata-mismatch" },
        "Compatibility avatar read degraded to the LINE profile",
      );
      return null;
    }
    return dataUrl(avatar.contentType, bytes);
  } catch (error) {
    logger.warn(
      {
        event: "compatibility.avatar.read.degraded",
        reason: "stored-avatar-unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Compatibility avatar read degraded to the LINE profile",
    );
    return null;
  }
}

/** 当事者として認可済みのAccountについて、設定画像からLINE画像へ安全に縮退する。 */
export async function resolveCompatibilityAvatarUrl(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<string | null> {
  const stored = await storedAvatarUrl(params, dependencies);
  if (stored) return stored;

  const verifiedLinePictureUrl = params.verifiedLinePictureUrl?.trim();
  if (verifiedLinePictureUrl) return verifiedLinePictureUrl;
  if (!params.lineChannelAccessToken) return null;

  try {
    const lineUserId = await dependencies.findLineIdentity(params.db, params.accountId);
    if (!lineUserId) return null;
    return await dependencies.getLinePictureUrl(params.lineChannelAccessToken, lineUserId);
  } catch (error) {
    // userId、LINE API response、画像URLはログへ含めない。
    logger.warn(
      {
        event: "compatibility.avatar.line.read.degraded",
        reason: "line-profile-unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Compatibility avatar read degraded to the default silhouette",
    );
    return null;
  }
}
