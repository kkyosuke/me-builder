import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const seedPath = path.resolve(__dirname, "../../../seeds/diagnoses.sql");

const VERSION_PATTERN =
  /INSERT INTO catalog_versions \(catalog_id, version, updated_at\) VALUES \('diagnosis', (\d+),/;

/** commentと`catalog_versions`自身を除いた、公開定義そのものの本文。 */
function catalogContent(seed: string): string {
  return seed
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0 && !statement.includes("catalog_versions"))
    .join("\n");
}

/**
 * catalog内容とversionを一緒に固定する。
 *
 * AccountDataはこのversionが進んだときだけsnapshotを同期するため、内容だけ変えて
 * versionを据え置くと、既存Accountは古い定義を持ち続け、新規Accountだけが新しい
 * 定義を見る。どちらにもエラーが出ないので、seedを変えた時点でここを失敗させる。
 *
 * 失敗したら、`catalog_versions`のversionを1つ上げてから期待値を更新する。
 */
describe("diagnosis seed catalog version", () => {
  it("catalog内容を変えたらcatalog_versionsのversionも上げる", () => {
    const seed = readFileSync(seedPath, "utf8");
    const content = catalogContent(seed);
    expect(content).toContain("INSERT OR IGNORE INTO questions");

    expect({
      version: seed.match(VERSION_PATTERN)?.[1],
      contentHash: createHash("sha256").update(content).digest("hex").slice(0, 16),
    }).toEqual({
      version: "8",
      contentHash: "0a4b726ef1d18381",
    });
  });
});
