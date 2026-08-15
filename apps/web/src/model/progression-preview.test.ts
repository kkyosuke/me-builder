import { describe, expect, it } from "vitest";
import { shouldShowProgressionPreview } from "./progression-preview";

describe("shouldShowProgressionPreview", () => {
  it("preview環境ではquery指定なしで表示する", () => {
    expect(shouldShowProgressionPreview("preview", "")).toBe(true);
  });

  it("local環境では明示した場合だけ表示する", () => {
    expect(shouldShowProgressionPreview("local", "")).toBe(false);
    expect(shouldShowProgressionPreview("local", "?progression-preview=1")).toBe(true);
  });

  it("production環境ではqueryを指定しても表示しない", () => {
    expect(shouldShowProgressionPreview("production", "?progression-preview=1")).toBe(false);
  });
});
