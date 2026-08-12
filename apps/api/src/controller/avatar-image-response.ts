import type { ProfileAvatarImage } from "../logic/profile-avatar-image";

/** 画像bytesをキャッシュ不能かつContent-Type推測不能なHTTP応答へ変換する。 */
export function avatarImageResponse(image: ProfileAvatarImage): Response {
  const body = image.bytes.buffer.slice(
    image.bytes.byteOffset,
    image.bytes.byteOffset + image.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
