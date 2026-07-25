import { describe, expect, it } from "vitest";
import { createLogger, logger } from "./logger";

describe("logger", () => {
  it("default logger should be defined and have logging methods", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });

  it("createLogger should create custom logger instance", () => {
    const customLogger = createLogger({ name: "custom-app", level: "debug" });
    expect(customLogger).toBeDefined();
    expect(customLogger.level).toBe("debug");
  });
});
