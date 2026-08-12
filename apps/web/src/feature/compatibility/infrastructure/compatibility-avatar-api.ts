import { compatibilityRelationshipId } from "@me-builder/lib/compatibility";
import { createHttpClient } from "../../../infrastructure/http-client";

const PROFILE_AVATAR_PATH = "/api/profile/avatar";
const INVITATION_AVATAR_PREFIX = "/api/compatibility/invitations/";
const INVITATION_AVATAR_SUFFIX = "/avatar";
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function isAllowedAvatarPath(path: string): boolean {
  if (path === PROFILE_AVATAR_PATH) return true;
  if (!path.startsWith(INVITATION_AVATAR_PREFIX) || !path.endsWith(INVITATION_AVATAR_SUFFIX)) {
    return false;
  }
  const relationshipId = path.slice(
    INVITATION_AVATAR_PREFIX.length,
    -INVITATION_AVATAR_SUFFIX.length,
  );
  return compatibilityRelationshipId.isValid(relationshipId);
}

/** APIが返した認可対象pathだけへBearerを送り、表示用Blobを取得する。 */
export async function fetchCompatibilityAvatarImage(
  apiUrl: string | undefined,
  idToken: string,
  avatarPath: string | null,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (!avatarPath || !isAllowedAvatarPath(avatarPath)) return null;
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request(avatarPath, {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  try {
    if (!response.ok || response.status === 204) return null;
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !SUPPORTED_IMAGE_TYPES.has(contentType)) return null;
    const blob = await response.blob();
    return blob.size > 0 && blob.size <= MAX_AVATAR_BYTES ? blob : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
