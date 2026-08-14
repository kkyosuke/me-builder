import { logger } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import {
  buildDevelopmentBrainItemMessage,
  createDiaryBrainResponseJsonSchema,
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

  it("属性schemaをGeminiへ渡すJSON Schemaへ変換できる", () => {
    expect(createDiaryBrainResponseJsonSchema()).toMatchObject({ type: "object" });
  });

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

  it("NFKCと空白の差を正規化して原文にあるstatementを受け入れる", () => {
    const normalizedMessages = [
      {
        id: "message-normalized",
        role: "user" as const,
        body: "Ａ  Ｂが好き",
        sequence: 1,
      },
    ];
    const candidate = {
      category: "preference",
      statement: "A Bが好き",
      source_message_ids: ["message-normalized"],
      is_inference: false,
    } as const;

    expect(
      validateDiaryBrainCandidates(
        JSON.stringify({ brain_item_candidates: [candidate] }),
        normalizedMessages,
        ["message-normalized"],
      ),
    ).toEqual([candidate]);
  });

  it("本人が明言した内容を6種類のBrain Itemとして受け入れる", () => {
    const classificationMessages = [
      "2026/07/21 牛タンを食べた",
      "昔いじめられてた",
      "衝動買いしちゃう",
      "承認されたいから頑張る",
      "安さより長く使えるものを選ぶ",
      "辛い食べ物が苦手",
      "来月までに転職先を決めたい",
    ].map((body, index) => ({
      id: `classification-${index + 1}`,
      role: "user" as const,
      body,
      sequence: index + 1,
    }));
    const categories = [
      "memory",
      "memory",
      "behavior_pattern",
      "value_motivation",
      "decision_system",
      "preference",
      "goal",
    ] as const;

    for (const [index, message] of classificationMessages.entries()) {
      const category = categories[index];
      if (!message || !category) throw new Error("分類test fixtureが不正です");
      const candidate = {
        category,
        statement: message.body,
        source_message_ids: [message.id],
        is_inference: false,
      };
      expect(
        validateDiaryBrainCandidates(
          JSON.stringify({ brain_item_candidates: [candidate] }),
          classificationMessages,
          [message.id],
        ),
      ).toEqual([candidate]);
    }
  });

  it("本人が明言した職業と週間リズムを別の声かけ属性として受け入れる", () => {
    const attributeMessages = [
      {
        id: "occupation-message",
        role: "user" as const,
        body: "看護師なの",
        sequence: 1,
      },
      {
        id: "rhythm-message",
        role: "user" as const,
        body: "休みはシフトで変わるよ",
        sequence: 2,
      },
    ];
    const candidates = [
      {
        category: "identity",
        statement: "看護師なの",
        source_message_ids: ["occupation-message"],
        is_inference: false,
        prompt_context: { kind: "occupation", occupation: "看護師" },
      },
      {
        category: "behavior_pattern",
        statement: "休みはシフトで変わるよ",
        source_message_ids: ["rhythm-message"],
        is_inference: false,
        prompt_context: { kind: "weekly_rhythm", scheduleMode: "variable_shift" },
      },
    ] as const;

    expect(
      validateDiaryBrainCandidates(
        JSON.stringify({ brain_item_candidates: candidates }),
        attributeMessages,
        attributeMessages.map(({ id }) => id),
      ),
    ).toEqual(candidates);
  });

  it("本人が明言していない声かけ属性を候補単位で破棄する", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const raw = JSON.stringify({
      brain_item_candidates: [
        {
          category: "behavior_pattern",
          statement: "看護師なの",
          source_message_ids: ["occupation-message"],
          is_inference: false,
          prompt_context: { kind: "weekly_rhythm", scheduleMode: "variable_shift" },
        },
      ],
    });

    expect(
      validateDiaryBrainCandidates(
        raw,
        [{ id: "occupation-message", role: "user", body: "看護師なの", sequence: 1 }],
        ["occupation-message"],
      ),
    ).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      { candidateIndex: 0, validationReason: "ungrounded_prompt_context" },
      "Skipped invalid Diary Brain candidate",
    );
    log.mockRestore();
  });

  it("occupation属性のないidentity候補を破棄する", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const candidate = {
      category: "identity",
      statement: "看護師なの",
      source_message_ids: ["occupation-message"],
      is_inference: false,
    } as const;

    expect(
      validateDiaryBrainCandidates(
        JSON.stringify({ brain_item_candidates: [candidate] }),
        [{ id: "occupation-message", role: "user", body: "看護師なの", sequence: 1 }],
        ["occupation-message"],
      ),
    ).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      { candidateIndex: 0, validationReason: "identity_without_occupation" },
      "Skipped invalid Diary Brain candidate",
    );
    log.mockRestore();
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
        category: "memory" as const,
        statement: "公園を散歩した",
        sourceMessageIds: ["message-1"],
        operation: "created" as const,
        deduplication: "none" as const,
      },
    ];
    expect(buildDevelopmentBrainItemMessage(candidates, "development")).toContain(
      "[dev] Brain Item反映結果\n- 1. [新規] memory: 公園を散歩した",
    );
    expect(buildDevelopmentBrainItemMessage(candidates, "preview")).toContain(
      "[dev] Brain Item反映結果\n- 1. [新規] memory: 公園を散歩した",
    );
    expect(buildDevelopmentBrainItemMessage(candidates, "production")).toBeUndefined();
  });

  it("development環境では保存結果が0件でも追加なしと通知する", () => {
    expect(buildDevelopmentBrainItemMessage([], "development")).toBe(
      "[dev] Brain Item反映結果\n- 追加なし",
    );
  });

  it("development環境では既存ItemへのEvidence追加と判定方法を通知する", () => {
    expect(
      buildDevelopmentBrainItemMessage(
        [
          {
            category: "preference",
            statement: "辛い食べ物が苦手",
            sourceMessageIds: ["message-2"],
            operation: "evidence_added",
            deduplication: "semantic",
          },
        ],
        "development",
      ),
    ).toContain("[Evidence追加/semantic] preference: 辛い食べ物が苦手");
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
