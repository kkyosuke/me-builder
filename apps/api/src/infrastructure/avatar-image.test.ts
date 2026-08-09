import { describe, expect, it, vi } from "vitest";
import {
  type AvatarImageError,
  MAX_AVATAR_UPLOAD_BYTES,
  normalizeAvatarImage,
} from "./avatar-image";

function imagesBinding(output = new Uint8Array([8, 9]).buffer) {
  const response = vi.fn(() => new Response(output.slice(0)));
  const outputImage = vi.fn(() => ({ response }));
  const transform = vi.fn(() => ({ output: outputImage }));
  const binding = {
    info: vi.fn().mockResolvedValue({ format: "image/png", width: 512, height: 400 }),
    input: vi.fn(() => ({ transform })),
  } as unknown as ApiBindings["IMAGES"];
  return { binding, info: binding.info, input: binding.input, transform, outputImage };
}

const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe("avatar image normalization", () => {
  it("JPEG・PNG・WebP以外をAIやdecoderへ渡す前に拒否する", async () => {
    const { binding, info } = imagesBinding();
    const file = new File(["<svg />"], "avatar.svg", { type: "image/svg+xml" });

    await expect(normalizeAvatarImage(file, binding)).rejects.toEqual(
      expect.objectContaining<Partial<AvatarImageError>>({ reason: "unsupported_image_type" }),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("Content-Typeとmagic bytesが一致しない画像を拒否する", async () => {
    const { binding, info } = imagesBinding();
    const file = new File(["not-png"], "avatar.png", { type: "image/png" });

    await expect(normalizeAvatarImage(file, binding)).rejects.toEqual(
      expect.objectContaining<Partial<AvatarImageError>>({ reason: "invalid_image" }),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("10MiBを超える画像を読み込まずに拒否する", async () => {
    const { binding, info } = imagesBinding();
    const file = new File([new Uint8Array(MAX_AVATAR_UPLOAD_BYTES + 1)], "avatar.png", {
      type: "image/png",
    });

    await expect(normalizeAvatarImage(file, binding)).rejects.toEqual(
      expect.objectContaining<Partial<AvatarImageError>>({ reason: "image_too_large" }),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("decode後に1024px正方形WebPへ再encodeする", async () => {
    const { binding, info, input, transform, outputImage } = imagesBinding();
    const file = new File([pngHeader], "avatar.png", { type: "image/png" });

    await expect(normalizeAvatarImage(file, binding)).resolves.toEqual({
      bytes: new Uint8Array([8, 9]),
      contentType: "image/webp",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(input).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledWith({
      width: 1024,
      height: 1024,
      fit: "cover",
      gravity: "face",
    });
    expect(outputImage).toHaveBeenCalledWith({ format: "image/webp", quality: 85, anim: false });
  });
});
