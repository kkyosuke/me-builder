import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES, validateAvatarImage } from "./avatar-image";

const validImages = {
  png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwHwwZGP6DAQBJyAn3iFfyTAAAAABJRU5ErkJggg==",
  jpeg: "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
  webp: "UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoCAAIAAUAmJaQAAudZtgAA/vZ//5wOIS38q//7Rj88te91eiYeAAAA",
} as const;

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function resizePng(width: number, height: number): Uint8Array {
  const bytes = decode(validImages.png);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(29, crc32(bytes, 12, 29));
  return bytes;
}

describe("validateAvatarImage", () => {
  it.each([
    [decode(validImages.png), "image/png", "png"],
    [decode(validImages.jpeg), "image/jpeg", "jpg"],
    [decode(validImages.webp), "image/webp", "webp"],
  ] as const)("デコード可能な対応画像の形式と寸法を検証する", (bytes, contentType, extension) => {
    expect(validateAvatarImage(bytes, contentType)).toMatchObject({
      type: "valid",
      contentType,
      extension,
      width: 2,
      height: 2,
    });
  });

  it.each([
    [decode(validImages.png).slice(0, 24), "image/png"],
    [decode(validImages.jpeg).slice(0, -2), "image/jpeg"],
    [decode(validImages.webp).slice(0, -2), "image/webp"],
  ] as const)("headerだけの切断画像を拒否する", (bytes, contentType) => {
    expect(validateAvatarImage(bytes, contentType)).toEqual({ type: "unsupported" });
  });

  it.each([
    [new Uint8Array(), "image/png", "empty"],
    [new Uint8Array(MAX_AVATAR_BYTES + 1), "image/png", "too-large"],
    [decode(validImages.png), "image/gif", "unsupported"],
    [decode(validImages.png), "image/jpeg", "content-type-mismatch"],
    [resizePng(2, 1), "image/png", "invalid-size"],
    [resizePng(513, 513), "image/png", "invalid-size"],
  ] as const)("不正な入力を拒否する", (bytes, contentType, type) => {
    expect(validateAvatarImage(bytes, contentType)).toEqual({ type });
  });
});
