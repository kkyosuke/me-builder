import { describe, expect, it } from "vitest";
import {
  DIARY_CHAT_PROMPT_VERSION,
  DIARY_CHAT_SYSTEM_PROMPT,
  buildDiaryChatSystemPrompt,
} from "./diary-chat";

describe("diary chat prompt", () => {
  it("質問なしを既定にし、会話継続だけの質問を禁止する", () => {
    expect(DIARY_CHAT_SYSTEM_PROMPT).toContain("質問しない応答を既定");
    expect(DIARY_CHAT_SYSTEM_PROMPT).toContain("会話を続けることだけを目的に質問しない");
    expect(DIARY_CHAT_SYSTEM_PROMPT).toContain("質問がなければ0");
  });

  it("追跡可能なprompt versionを持つ", () => {
    expect(DIARY_CHAT_PROMPT_VERSION).toMatch(/^diary-chat-v\d+$/u);
  });

  it("会話の目的と話し方・質問方法を独立して流し込める", () => {
    const prompt = buildDiaryChatSystemPrompt({
      objective: "選択の背景にある行動原理を、仮説として探る。",
      conversationGuidance: "短く共感してから、必要な場合だけ質問する。",
    });

    expect(prompt).toContain("## 会話の目的\n選択の背景にある行動原理を、仮説として探る。");
    expect(prompt).toContain("## 話し方と質問方法\n短く共感してから、必要な場合だけ質問する。");
    expect(prompt).toContain("## 安全");
  });

  it("空の目的または会話方針を拒否する", () => {
    expect(() =>
      buildDiaryChatSystemPrompt({ objective: " ", conversationGuidance: "短く返す" }),
    ).toThrow();
  });
});
