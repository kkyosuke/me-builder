import { describe, expect, it } from "vitest";
import { buildDevelopmentBrainItemMessage, validateDiaryBrainCandidates } from "./diary-brain";

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
        category: "memory" as const,
        statement: "公園を散歩した",
        source_message_ids: ["message-1"],
        is_inference: false as const,
      },
    ];
    expect(buildDevelopmentBrainItemMessage(candidates, "development")).toContain(
      "[dev] 追加したBrain Item\n- 1. Memory: 公園を散歩した",
    );
    expect(buildDevelopmentBrainItemMessage(candidates, "production")).toBeUndefined();
  });
});
