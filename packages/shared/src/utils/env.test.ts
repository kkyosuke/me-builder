import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "./env";

describe("getEnv helper", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("prioritizes env argument over process.env", () => {
    process.env.FOO = "from_process";
    const cfEnv = { FOO: "from_cf" };
    expect(getEnv("FOO", cfEnv)).toBe("from_cf");
  });

  it("falls back to process.env if key is missing in env argument", () => {
    process.env.BAR = "from_process";
    const cfEnv = { BAZ: "other" };
    expect(getEnv("BAR", cfEnv)).toBe("from_process");
  });

  it("supports array of candidate keys", () => {
    const cfEnv = { NODE_ENV: "production" };
    expect(getEnv(["ENVIRONMENT", "NODE_ENV"], cfEnv)).toBe("production");
  });

  it("returns defaultValue if not found anywhere", () => {
    expect(getEnv("UNKNOWN_KEY", undefined, "default_val")).toBe("default_val");
  });
});
