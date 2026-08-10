import { logger } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import {
  buildDevelopmentBrainItemMessage,
  generateDiaryBrainCandidates,
  validateDiaryBrainCandidates,
} from "./diary-brain";

describe("diary Brain checkpoint", () => {
  const messages = [
    {
      id: "message-1",
      role: "user" as const,
      body: "今日は公園を散歩した",
      sequence: 1,
    },
    {
      id: "message-2",
      role: "user" as const,
      body: "夕食を作った",
      sequence: 2,
    },
  ];

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
    expect(validateDiaryBrainCandidates(raw, messages, ["message-1", "message-2"])).toHaveLength(2);
  });

  it("checkpoint外のmessageを参照する候補だけをlog付きで破棄する", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
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
    expect(validateDiaryBrainCandidates(raw, messages, ["message-1"])).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      { candidateIndex: 0, validationReason: "outside_checkpoint_evidence" },
      "Skipped invalid Diary Brain candidate",
    );
    log.mockRestore();
  });

  it("同一候補が複数ある場合は最初の1件だけを受け入れる", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const duplicate = {
      category: "memory",
      statement: "公園を散歩した",
      source_message_ids: ["message-1"],
      is_inference: false,
    };
    const raw = JSON.stringify({
      brain_item_candidates: [
        duplicate,
        duplicate,
        {
          category: "memory",
          statement: "夕食を作った",
          source_message_ids: ["message-2"],
          is_inference: false,
        },
      ],
    });

    expect(validateDiaryBrainCandidates(raw, messages, ["message-1", "message-2"])).toEqual([
      duplicate,
      expect.objectContaining({ statement: "夕食を作った" }),
    ]);
    expect(log).toHaveBeenCalledWith(
      { candidateIndex: 1, validationReason: "duplicate_candidate" },
      "Skipped invalid Diary Brain candidate",
    );
    log.mockRestore();
  });

  it("AIが明示した候補0件だけは正常な0件として受け入れる", () => {
    expect(
      validateDiaryBrainCandidates(JSON.stringify({ brain_item_candidates: [] }), messages, [
        "message-1",
      ]),
    ).toEqual([]);
  });

  it("空白statementと発言にないstatementをlog付きで候補単位に破棄する", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const raw = JSON.stringify({
      brain_item_candidates: [
        {
          category: "memory",
          statement: "   ",
          source_message_ids: ["message-1"],
          is_inference: false,
        },
        {
          category: "memory",
          statement: "海へ行った",
          source_message_ids: ["message-1"],
          is_inference: false,
        },
        {
          category: "memory",
          statement: "公園を散歩した",
          source_message_ids: ["message-1"],
          is_inference: false,
        },
      ],
    });

    expect(validateDiaryBrainCandidates(raw, messages, ["message-1"])).toEqual([
      expect.objectContaining({ statement: "公園を散歩した" }),
    ]);
    expect(log).toHaveBeenCalledWith(
      { candidateIndex: 0, validationReason: "empty_statement" },
      "Skipped invalid Diary Brain candidate",
    );
    expect(log).toHaveBeenCalledWith(
      { candidateIndex: 1, validationReason: "ungrounded_statement" },
      "Skipped invalid Diary Brain candidate",
    );
    log.mockRestore();
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
    expect(buildDevelopmentBrainItemMessage(candidates, "preview")).toContain(
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
    const withoutAiCredentials = {
      GOOGLE_VERTEX_AI_API_KEY: "",
    };
    await expect(
      generateDiaryBrainCandidates(
        [],
        [],
        getWorkerConfig({ ...withoutAiCredentials, ENVIRONMENT: "local" }),
      ),
    ).resolves.toEqual([]);
    await expect(
      generateDiaryBrainCandidates(
        [],
        [],
        getWorkerConfig({ ...withoutAiCredentials, ENVIRONMENT: "production" }),
      ),
    ).resolves.toBeUndefined();
  });
});
