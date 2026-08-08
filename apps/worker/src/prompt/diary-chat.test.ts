import { describe, expect, it } from "vitest";
import { DIARY_CHAT_PROMPT_VERSION, DIARY_CHAT_SYSTEM_PROMPT } from "./diary-chat";

describe("diary chat prompt", () => {
  it("質問なしを既定にし、会話継続だけの質問を禁止する", () => {
    expect(DIARY_CHAT_SYSTEM_PROMPT).toContain("質問しない応答を既定");
    expect(DIARY_CHAT_SYSTEM_PROMPT).toContain("会話を続けることだけを目的に質問しない");
    expect(DIARY_CHAT_SYSTEM_PROMPT).toContain("質問がなければ0");
  });

  it("追跡可能なprompt versionを持つ", () => {
    expect(DIARY_CHAT_PROMPT_VERSION).toMatch(/^diary-chat-v\d+$/u);
  });
});
