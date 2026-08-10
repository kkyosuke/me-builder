import { describe, expect, it } from "vitest";
import { buildDropTablesSql, parseSchema, sortTablesForDrop } from "./reset-preview-d1";

describe("Preview D1 reset", () => {
  it("Wranglerの結果からユーザーテーブルとmigration履歴を取得する", () => {
    expect(
      parseSchema(
        JSON.stringify([
          {
            success: true,
            results: [
              { kind: "table", name: "accounts", parent: null },
              { kind: "table", name: "account_identities", parent: null },
              { kind: "table", name: "d1_migrations", parent: null },
              { kind: "foreign-key", name: "account_identities", parent: "accounts" },
            ],
          },
        ]),
      ),
    ).toEqual({
      tableNames: ["accounts", "account_identities", "d1_migrations"],
      foreignKeys: [{ child: "account_identities", parent: "accounts" }],
    });
  });

  it("外部キーの子から親の順に識別子をquoteしたDROP文を生成する", () => {
    expect(
      buildDropTablesSql(
        ['odd"name', "accounts", "account_identities", "accounts"],
        [{ child: "account_identities", parent: "accounts" }],
      ),
    ).toBe(
      'DROP TABLE IF EXISTS "account_identities";\nDROP TABLE IF EXISTS "accounts";\nDROP TABLE IF EXISTS "odd""name";',
    );
  });

  it("循環する外部キーがある場合は削除を拒否する", () => {
    expect(() =>
      sortTablesForDrop(
        ["left", "right"],
        [
          { child: "left", parent: "right" },
          { child: "right", parent: "left" },
        ],
      ),
    ).toThrow("D1 schema contains cyclic foreign keys");
  });

  it("不正なWranglerレスポンスを拒否する", () => {
    expect(() => parseSchema(JSON.stringify({ results: [] }))).toThrow(
      "Unexpected Wrangler D1 JSON response",
    );
    expect(() => parseSchema(JSON.stringify([{ success: false }]))).toThrow(
      "Wrangler failed to list D1 tables",
    );
  });
});
