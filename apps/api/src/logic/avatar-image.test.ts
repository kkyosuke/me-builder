import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES, validateAvatarImage } from "./avatar-image";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set(
    [
      encodedWidth & 0xff,
      (encodedWidth >> 8) & 0xff,
      (encodedWidth >> 16) & 0xff,
      encodedHeight & 0xff,
      (encodedHeight >> 8) & 0xff,
      (encodedHeight >> 16) & 0xff,
    ],
    24,
  );
  return bytes;
}

describe("validateAvatarImage", () => {
  it.each([
    [png(512, 512), "image/png", "png"],
    [jpeg(256, 256), "image/jpeg", "jpg"],
    [webp(128, 128), "image/webp", "webp"],
  ] as const)("対応画像の形式と正方形の寸法を検証する", (bytes, contentType, extension) => {
    expect(validateAvatarImage(bytes, contentType)).toMatchObject({
      type: "valid",
      contentType,
      extension,
    });
  });

  it.each([
    [new Uint8Array(), "image/png", "empty"],
    [new Uint8Array(MAX_AVATAR_BYTES + 1), "image/png", "too-large"],
    [png(256, 256), "image/gif", "unsupported"],
    [png(256, 256), "image/jpeg", "content-type-mismatch"],
    [png(256, 128), "image/png", "invalid-size"],
    [png(513, 513), "image/png", "invalid-size"],
  ] as const)("不正な入力を拒否する", (bytes, contentType, type) => {
    expect(validateAvatarImage(bytes, contentType)).toEqual({ type });
  });
});
