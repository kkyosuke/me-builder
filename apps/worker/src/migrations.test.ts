import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// AccountDataのtable定義はpackages/libが所有するため、migrationも同じ場所にある。
const MIGRATION_DIRECTORIES = [
  path.resolve(__dirname, "../../../packages/lib/drizzle-account-data"),
  path.resolve(__dirname, "../drizzle/compatibility-data"),
  path.resolve(__dirname, "../drizzle/conversation-coordinator"),
];

describe("Durable Object clean baseline migrations", () => {
  it.each(MIGRATION_DIRECTORIES)("%sは0000から連番で持つ", (directory) => {
    const files = readdirSync(directory)
      .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
      .sort();
    expect(files[0]).toMatch(/^0000_.+\.sql$/);
    expect(files.map((filename) => filename.slice(0, 4))).toEqual(
      files.map((_, index) => index.toString().padStart(4, "0")),
    );
  });
});
