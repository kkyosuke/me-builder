import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index";

describe("shared package", () => {
  it("should export correct APP_NAME", () => {
    expect(APP_NAME).toBe("me-builder");
  });
});
