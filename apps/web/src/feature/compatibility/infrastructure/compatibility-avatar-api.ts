import { createHttpClient } from "../../../infrastructure/http-client";

const AVATAR_PATH_PATTERN =
  /^\/api\/(?:profile\/avatar|compatibility\/invitations\/[a-f0-9]{64}\/avatar)$/;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** APIが返した認可対象pathだけへBearerを送り、表示用Blobを取得する。 */
export async function fetchCompatibilityAvatarImage(
  apiUrl: string | undefined,
  idToken: string,
  avatarPath: string | null,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (!avatarPath || !AVATAR_PATH_PATTERN.test(avatarPath)) return null;
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
