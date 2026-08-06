import { describe, expect, it } from "vitest";
import {
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

  it("事前分類よりモデルの安全routeを弱めない", () => {
    expect(stricterSafetyRoute("self_harm_possible", "normal")).toBe("self_harm_possible");
  });

  it("自傷の可能性を検知して危機向けfallbackを返す", () => {
    const route = classifySafety([
      { id: "message-2", role: "user", body: "消えてしまいたい", sequence: 2 },
    ]);
    expect(route).toBe("self_harm_possible");
    expect(buildSafetyFallback(route)).toMatchObject({
      safety: { route: "self_harm_possible", restricted_advice: true },
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
