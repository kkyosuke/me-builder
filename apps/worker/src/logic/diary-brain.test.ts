import { describe, expect, it } from "vitest";
import { getWorkerConfig } from "../config";
import {
  buildDevelopmentBrainItemMessage,
  generateDiaryBrainCandidates,
  validateDiaryBrainCandidates,
} from "./diary-brain";

describe("diary Brain checkpoint", () => {
  it("checkpoint内の複数messageを根拠にしたMemory候補を受け入れる", () => {
    const raw = JSON.stringify({
      brain_item_candidates: [
        {
          category: "memory",
          statement: "公園を散歩した",
          source_message_ids: ["message-1"],
          is_inference: false,
        },
        {
          category: "memory",
          statement: "夕食を作った",
          source_message_ids: ["message-2"],
          is_inference: false,
        },
      ],
    });
    expect(validateDiaryBrainCandidates(raw, ["message-1", "message-2"])).toHaveLength(2);
  });

  it("checkpoint外のmessageを参照する候補だけを破棄する", () => {
    const raw = JSON.stringify({
      brain_item_candidates: [
        {
          category: "memory",
          statement: "別の会話の内容",
          source_message_ids: ["old-message"],
          is_inference: false,
        },
      ],
    });
    expect(validateDiaryBrainCandidates(raw, ["message-1"])).toEqual([]);
  });

  it("development環境だけ追加結果の通知文を作る", () => {
    const candidates = [
      {
        statement: "公園を散歩した",
        sourceMessageIds: ["message-1"],
      },
    ];
    expect(buildDevelopmentBrainItemMessage(candidates, "development")).toContain(
      "[dev] 追加したBrain Item\n- 1. Memory: 公園を散歩した",
    );
    expect(buildDevelopmentBrainItemMessage(candidates, "production")).toBeUndefined();
  });

  it("development環境では保存結果が0件でも追加なしと通知する", () => {
    expect(buildDevelopmentBrainItemMessage([], "development")).toBe(
      "[dev] 追加したBrain Item\n- 追加なし",
    );
  });

  it("AI設定不足はlocalでは0件、本番では再試行対象にする", async () => {
    await expect(
      generateDiaryBrainCandidates([], [], getWorkerConfig({ ENVIRONMENT: "local" })),
    ).resolves.toEqual([]);
    await expect(
      generateDiaryBrainCandidates([], [], getWorkerConfig({ ENVIRONMENT: "production" })),
    ).resolves.toBeUndefined();
  });
});
