import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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

  it("AccountDataの配布済みmigration履歴を変更しない", () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsRoot, "account-data/meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };

    expect(journal.entries.slice(0, 4)).toEqual([
      {
        idx: 0,
        version: "6",
        when: 1786225592462,
        tag: "0000_mysterious_prowler",
        breakpoints: true,
      },
      {
        idx: 1,
        version: "6",
        when: 1786237023391,
        tag: "0001_famous_lila_cheney",
        breakpoints: true,
      },
      { idx: 2, version: "6", when: 1786240705836, tag: "0002_wealthy_cloak", breakpoints: true },
      {
        idx: 3,
        version: "6",
        when: 1786243557706,
        tag: "0003_futuristic_white_queen",
        breakpoints: true,
      },
    ]);

    const deployedMigrations = [
      [
        "0000_mysterious_prowler.sql",
        "b00c47053466d18fa4f3d943131c2a7a76d4e891bea0f50527fd5a36d453ab0b",
      ],
      [
        "0001_famous_lila_cheney.sql",
        "890c6120f364ae1b91f06acb627e6a444df824de2546ce951384331e3c0d8b95",
      ],
      [
        "0002_wealthy_cloak.sql",
        "01c8cc9e6298531643fbe3f810feff25522c26bb6c354d3cb0cd15ae069ab756",
      ],
      [
        "0003_futuristic_white_queen.sql",
        "90770fbec5cc719ff11b56e877bd4aa793ef375f5e448f012ea33bcf8e6a0c21",
      ],
    ] as const;
    expect(
      deployedMigrations.map(([filename]) =>
        createHash("sha256")
          .update(readFileSync(path.join(migrationsRoot, "account-data", filename)))
          .digest("hex"),
      ),
    ).toEqual(deployedMigrations.map(([, hash]) => hash));
  });
});
