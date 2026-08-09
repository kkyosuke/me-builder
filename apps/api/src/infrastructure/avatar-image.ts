export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AvatarImageErrorReason = "unsupported_image_type" | "image_too_large" | "invalid_image";

export class AvatarImageError extends Error {
  constructor(readonly reason: AvatarImageErrorReason) {
    super(reason);
    this.name = "AvatarImageError";
  }
}

function detectedType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

type ImagesInput = Parameters<ApiBindings["IMAGES"]["input"]>[0];

function stream(bytes: Uint8Array): ImagesInput {
  return new Blob([bytes.slice().buffer]).stream() as unknown as ImagesInput;
}

/** 入力をdecodeし、中央を正方形に切り出したWebPへ再encodeしてmetadataを除去する。 */
export async function normalizeAvatarImage(
  file: File,
  images: ApiBindings["IMAGES"],
): Promise<{ bytes: Uint8Array; contentType: "image/webp" }> {
  if (!SUPPORTED_TYPES.has(file.type)) throw new AvatarImageError("unsupported_image_type");
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) throw new AvatarImageError("image_too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectedType(bytes) !== file.type) throw new AvatarImageError("invalid_image");

  try {
    const info = await images.info(stream(bytes));
    if (
      info.format === "image/svg+xml" ||
      !("width" in info) ||
      info.width < 1 ||
      info.height < 1
    ) {
      throw new AvatarImageError("invalid_image");
    }
    const result = await images
      .input(stream(bytes))
      .transform({ width: 1024, height: 1024, fit: "cover", gravity: "face" })
      .output({ format: "image/webp", quality: 85, anim: false });
    const response = result.response();
    if (!response.ok) throw new AvatarImageError("invalid_image");
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: "image/webp",
    };
  } catch (error) {
    if (error instanceof AvatarImageError) throw error;
    throw new AvatarImageError("invalid_image");
  }
}
