import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsRoot = path.resolve(__dirname, "../drizzle");

describe("Durable Object clean baseline migrations", () => {
  it.each(["account-data", "compatibility-data", "conversation-coordinator"])(
    "%sは0000から連番で持つ",
    (directory) => {
      const files = readdirSync(path.join(migrationsRoot, directory))
        .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
        .sort();
      expect(files[0]).toMatch(/^0000_.+\.sql$/);
      expect(files.map((filename) => filename.slice(0, 4))).toEqual(
        files.map((_, index) => index.toString().padStart(4, "0")),
      );
    },
  );
});
