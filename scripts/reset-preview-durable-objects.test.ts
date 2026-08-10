import { describe, expect, it } from "vitest";
import {
  chunkObjectIds,
  parseStoredObjectIds,
  selectResetNamespaces,
} from "./reset-preview-durable-objects";

describe("Preview Durable Object reset", () => {
  it("Preview Workerの3つのSQLite namespaceを選択する", () => {
    expect(
      Object.fromEntries(
        selectResetNamespaces([
          {
            success: true,
            result: [
              {
                id: "account",
                class: "AccountData",
                script: "me-builder-worker-preview",
                use_sqlite: true,
              },
              {
                id: "compat",
                class: "CompatibilityData",
                script: "me-builder-worker-preview",
                use_sqlite: true,
              },
              {
                id: "chat",
                class: "ConversationCoordinator",
                script: "me-builder-worker-preview",
                use_sqlite: true,
              },
              {
                id: "prod",
                class: "AccountData",
                script: "me-builder-worker-production",
                use_sqlite: true,
              },
            ],
          },
        ]),
      ),
    ).toEqual({
      AccountData: "account",
      CompatibilityData: "compat",
      ConversationCoordinator: "chat",
    });
  });

  it("保存データがあるobjectだけを取得してcursorを返す", () => {
    expect(
      parseStoredObjectIds({
        success: true,
        result: [
          { id: "stored", hasStoredData: true },
          { id: "empty", hasStoredData: false },
        ],
        result_info: { cursor: "next" },
      }),
    ).toEqual({ ids: ["stored"], cursor: "next" });
  });

  it("object IDを指定件数で分割する", () => {
    expect(chunkObjectIds(["1", "2", "3"], 2)).toEqual([["1", "2"], ["3"]]);
  });

  it("namespace不足を拒否する", () => {
    expect(() => selectResetNamespaces([{ success: true, result: [] }])).toThrow(
      "Preview namespace was not found",
    );
  });
});
