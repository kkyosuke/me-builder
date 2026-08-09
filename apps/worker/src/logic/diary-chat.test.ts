import { describe, expect, it } from "vitest";
import {
  appendDevelopmentBrainItemSummary,
  buildSafetyFallback,
  classifySafety,
  stricterSafetyRoute,
  validateDiaryChatResponse,
} from "./diary-chat";

const messages = [
  { id: "message-1", role: "user" as const, body: "今日は仕事で失敗して落ち込んだ", sequence: 1 },
];

describe("diary chat guardrails", () => {
  it("schemaと質問数を検証する", () => {
    const valid = JSON.stringify({
      mode: "explore",
      reply: "それは落ち込むよね。いちばん悔しかったのはどこ？",
      main_question_count: 1,
      end_session: false,
      safety: { route: "normal", restricted_advice: false },
    });
    expect(validateDiaryChatResponse(valid, "normal")?.mode).toBe("explore");
  });

  it("現在のTurnを根拠にしたMemory候補を受け入れる", () => {
    const raw = JSON.stringify({
      mode: "organize",
      reply: "今日は仕事で失敗して落ち込んだことを記録したよ。",
      main_question_count: 0,
      end_session: false,
      safety: { route: "normal", restricted_advice: false },
      brain_item_candidates: [
        {
          category: "memory",
          statement: "仕事で失敗して落ち込んだ",
          source_message_ids: ["message-1"],
          is_inference: false,
        },
      ],
    });

    expect(validateDiaryChatResponse(raw, "normal", ["message-1"])?.brain_item_candidates).toEqual([
      expect.objectContaining({
        statement: "仕事で失敗して落ち込んだ",
        source_message_ids: ["message-1"],
      }),
    ]);
  });

  it("現在のTurn以外を根拠にした候補だけを破棄する", () => {
    const raw = JSON.stringify({
      mode: "listen",
      reply: "書いてくれたことを受け取ったよ。",
      main_question_count: 0,
      end_session: false,
      safety: { route: "normal", restricted_advice: false },
      brain_item_candidates: [
        {
          category: "memory",
          statement: "別の会話の内容",
          source_message_ids: ["old-message"],
          is_inference: false,
        },
      ],
    });

    expect(validateDiaryChatResponse(raw, "normal", ["message-1"])?.brain_item_candidates).toEqual(
      [],
    );
  });

  it("development環境では追加対象を返信へ表示する", () => {
    expect(
      appendDevelopmentBrainItemSummary(
        "受け取ったよ。",
        [
          {
            category: "memory",
            statement: "公園を散歩した",
            source_message_ids: ["message-1"],
            is_inference: false,
          },
        ],
        "development",
      ),
    ).toContain("[dev] 追加したBrain Item\n- 1. Memory: 公園を散歩した");
    expect(appendDevelopmentBrainItemSummary("受け取ったよ。", [], "production")).toBe(
      "受け取ったよ。",
    );
  });

  it("事前分類よりモデルの安全routeを弱めない", () => {
    expect(stricterSafetyRoute("self_harm_possible", "normal")).toBe("self_harm_possible");
  });

  it("自傷の可能性を検知して危機向けfallbackを返す", () => {
    const route = classifySafety([
      { id: "message-2", role: "user", body: "消えてしまいたい", sequence: 2 },
    ]);
    expect(route).toBe("self_harm_possible");
    expect(buildSafetyFallback(route)).toMatchObject({
      main_question_count: 1,
      safety: { route: "self_harm_possible", restricted_advice: true },
      brain_item_candidates: [],
    });
  });

  it("通常時のfallbackへ会話継続だけの質問を付けない", () => {
    expect(buildSafetyFallback("normal")).toMatchObject({
      main_question_count: 0,
      safety: { route: "normal", restricted_advice: false },
    });
  });

  it("通常の日記を危機扱いしない", () => {
    expect(classifySafety(messages)).toBe("normal");
  });

  it("連投Turnの先頭にある危機表現も見落とさない", () => {
    const coalesced = [
      { id: "first", role: "user" as const, body: "死にたい", sequence: 1 },
      { id: "second", role: "user" as const, body: "でも今日は仕事した", sequence: 2 },
    ];
    expect(classifySafety(coalesced, ["first", "second"])).toBe("self_harm_possible");
  });
});
