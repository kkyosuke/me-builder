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

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = (crc >>> 8) ^ (crc32Table[(crc ^ (bytes[offset] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPngHeader(bytes: Uint8Array, dataOffset: number): boolean {
  const bitDepth = bytes[dataOffset + 8];
  const colorType = bytes[dataOffset + 9];
  const validBitDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return Boolean(
    bitDepth !== undefined &&
      colorType !== undefined &&
      validBitDepths[colorType]?.includes(bitDepth) &&
      bytes[dataOffset + 10] === 0 &&
      bytes[dataOffset + 11] === 0 &&
      (bytes[dataOffset + 12] === 0 || bytes[dataOffset + 12] === 1),
  );
}

function detectPng(bytes: Uint8Array): DetectedImage | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) {
    return undefined;
  }

  let offset = 8;
  let width: number | undefined;
  let height: number | undefined;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset, false);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) return undefined;
    const type = ascii(bytes, typeOffset, 4);
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      uint32(bytes, dataEnd, false) !== crc32(bytes, typeOffset, dataEnd)
    ) {
      return undefined;
    }

    if (offset === 8) {
      if (type !== "IHDR" || length !== 13 || !validPngHeader(bytes, dataOffset)) return undefined;
      width = uint32(bytes, dataOffset, false);
      height = uint32(bytes, dataOffset + 4, false);
    } else if (type === "IHDR") {
      return undefined;
    } else if (type === "PLTE") {
      if (sawPalette || sawImageData || length === 0 || length % 3 !== 0 || length > 768) {
        return undefined;
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (imageDataEnded || length === 0) return undefined;
      sawImageData = true;
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }

    if (type === "IEND") {
      if (length !== 0 || !sawImageData || chunkEnd !== bytes.length) return undefined;
      return width === undefined || height === undefined
        ? undefined
        : { contentType: "image/png", extension: "png", width, height };
    }
    offset = chunkEnd;
  }
  return undefined;
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function detectJpeg(bytes: Uint8Array): DetectedImage | undefined {
  if (bytes.length < 14 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  let width: number | undefined;
  let height: number | undefined;
  let sawScan = false;
  let scanByteLength = 0;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const markerOffset = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset] as number;
    offset += 1;

    if (marker === 0xd9) {
      return offset === bytes.length &&
        width !== undefined &&
        height !== undefined &&
        sawScan &&
        scanByteLength > 0
        ? { contentType: "image/jpeg", extension: "jpg", width, height }
        : undefined;
    }
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return undefined;
    if (marker === 0x01) continue;
    if (offset + 1 >= bytes.length) return undefined;
    const segmentLength = uint16(bytes, offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;

    if (jpegStartOfFrameMarkers.has(marker)) {
      const componentCount = bytes[offset + 7];
      if (
        width !== undefined ||
        componentCount === undefined ||
        componentCount === 0 ||
        segmentLength !== 8 + componentCount * 3
      ) {
        return undefined;
      }
      height = uint16(bytes, offset + 3, false);
      width = uint16(bytes, offset + 5, false);
    }

    offset += segmentLength;
    if (marker !== 0xda) continue;
    const componentCount = bytes[offset - segmentLength + 2];
    if (
      width === undefined ||
      componentCount === undefined ||
      componentCount === 0 ||
      segmentLength !== 6 + componentCount * 2
    ) {
      return undefined;
    }
    sawScan = true;

    let nextMarkerOffset: number | undefined;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        scanByteLength += 1;
        offset += 1;
        continue;
      }
      const candidateOffset = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return undefined;
      const candidate = bytes[offset] as number;
      if (candidate === 0x00 || (candidate >= 0xd0 && candidate <= 0xd7)) {
        scanByteLength += candidate === 0x00 ? 1 : 0;
        offset += 1;
        continue;
      }
      nextMarkerOffset = candidateOffset;
      break;
    }
    if (nextMarkerOffset === undefined) return undefined;
    offset = nextMarkerOffset;
    if (offset <= markerOffset) return undefined;
  }
  return undefined;
}

function detectWebp(bytes: Uint8Array): DetectedImage | undefined {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    uint32(bytes, 4, true) + 8 !== bytes.length
  ) {
    return undefined;
  }

  let offset = 12;
  let canvas: Readonly<{ width: number; height: number }> | undefined;
  let image: Readonly<{ width: number; height: number }> | undefined;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = uint32(bytes, offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + (length % 2);
    if (dataEnd > bytes.length || chunkEnd > bytes.length) return undefined;

    if (type === "VP8X") {
      if (canvas || image || length !== 10) return undefined;
      canvas = {
        width: uint24(bytes, dataOffset + 4) + 1,
        height: uint24(bytes, dataOffset + 7) + 1,
      };
    } else if (type === "VP8L") {
      if (image || length < 5 || bytes[dataOffset] !== 0x2f) return undefined;
      const bits = uint32(bytes, dataOffset + 1, true);
      image = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    } else if (type === "VP8 ") {
      if (
        image ||
        length < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return undefined;
      }
      image = {
        width: uint16(bytes, dataOffset + 6, true) & 0x3fff,
        height: uint16(bytes, dataOffset + 8, true) & 0x3fff,
      };
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.length || !image) return undefined;
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) return undefined;
  return { contentType: "image/webp", extension: "webp", ...image };
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
