export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 512;

type AvatarContentType = "image/jpeg" | "image/png" | "image/webp";

export type ValidAvatarImage = Readonly<{
  type: "valid";
  bytes: Uint8Array;
  contentType: AvatarContentType;
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
}>;

export type AvatarImageValidation =
  | ValidAvatarImage
  | Readonly<{
      type: "empty" | "too-large" | "unsupported" | "content-type-mismatch" | "invalid-size";
    }>;

type DetectedImage = Readonly<{
  contentType: AvatarContentType;
  extension: ValidAvatarImage["extension"];
  width: number;
  height: number;
}>;

function uint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  const first = bytes[offset] ?? 0;
  const second = bytes[offset + 1] ?? 0;
  return littleEndian ? first | (second << 8) : (first << 8) | second;
}

function uint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian,
  );
}

function detectPng(bytes: Uint8Array): DetectedImage | undefined {
  if (bytes.length < 24) return undefined;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return undefined;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return undefined;
  return {
    contentType: "image/png",
    extension: "png",
    width: uint32(bytes, 16, false),
    height: uint32(bytes, 20, false),
  };
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function detectJpeg(bytes: Uint8Array): DetectedImage | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset] as number;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return undefined;
    const segmentLength = uint16(bytes, offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return undefined;
      return {
        contentType: "image/jpeg",
        extension: "jpg",
        height: uint16(bytes, offset + 3, false),
        width: uint16(bytes, offset + 5, false),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function detectWebp(bytes: Uint8Array): DetectedImage | undefined {
  if (bytes.length < 30) return undefined;
  if (
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
  ) {
    return undefined;
  }
  const format = String.fromCharCode(...bytes.slice(12, 16));
  if (format === "VP8X") {
    return {
      contentType: "image/webp",
      extension: "webp",
      width: uint24(bytes, 24) + 1,
      height: uint24(bytes, 27) + 1,
    };
  }
  if (format === "VP8L" && bytes[20] === 0x2f) {
    const bits = uint32(bytes, 21, true);
    return {
      contentType: "image/webp",
      extension: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (format === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      contentType: "image/webp",
      extension: "webp",
      width: uint16(bytes, 26, true) & 0x3fff,
      height: uint16(bytes, 28, true) & 0x3fff,
    };
  }
  return undefined;
}

function normalizeContentType(value: string | undefined): AvatarContentType | undefined {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp"
    ? contentType
    : undefined;
}

export function validateAvatarImage(
  bytes: Uint8Array,
  requestContentType: string | undefined,
): AvatarImageValidation {
  if (bytes.byteLength === 0) return { type: "empty" };
  if (bytes.byteLength > MAX_AVATAR_BYTES) return { type: "too-large" };
  const contentType = normalizeContentType(requestContentType);
  if (!contentType) return { type: "unsupported" };

  const detected = detectPng(bytes) ?? detectJpeg(bytes) ?? detectWebp(bytes);
  if (!detected) return { type: "unsupported" };
  if (detected.contentType !== contentType) return { type: "content-type-mismatch" };
  if (
    detected.width < 1 ||
    detected.height < 1 ||
    detected.width !== detected.height ||
    detected.width > MAX_AVATAR_DIMENSION ||
    detected.height > MAX_AVATAR_DIMENSION
  ) {
    return { type: "invalid-size" };
  }
  return { type: "valid", bytes, ...detected };
}
