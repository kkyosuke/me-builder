import { describe, expect, it } from "vitest";
import { calculateAvatarCrop } from "./normalize-avatar-image";

describe("calculateAvatarCrop", () => {
  it("横長画像の中央を正方形に切り抜いて最大512pxへ縮小する", () => {
    expect(calculateAvatarCrop(1600, 900)).toEqual({
      sourceX: 350,
      sourceY: 0,
      sourceSize: 900,
      outputSize: 512,
    });
  });

  it("縦長画像の中央を正方形に切り抜いて最大512pxへ縮小する", () => {
    expect(calculateAvatarCrop(800, 1200)).toEqual({
      sourceX: 0,
      sourceY: 200,
      sourceSize: 800,
      outputSize: 512,
    });
  });

  it("小さい正方形画像は拡大しない", () => {
    expect(calculateAvatarCrop(320, 320)).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceSize: 320,
      outputSize: 320,
    });
  });
});
