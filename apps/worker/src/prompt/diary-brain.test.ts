import { describe, expect, it } from "vitest";
import { DIARY_BRAIN_PROMPT_VERSION, DIARY_BRAIN_SYSTEM_PROMPT } from "./diary-brain";

describe("diary Brain prompt", () => {
  it("分類境界と相対日付の保持を明示する", () => {
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("「衝動買いしちゃう」→ behavior_pattern");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("「承認されたいから頑張る」→ value_motivation");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("「来月までに転職先を決めたい」→ goal");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("相対日付も書き換えずstatementへ含める");
  });

  it("追跡可能なprompt versionを持つ", () => {
    expect(DIARY_BRAIN_PROMPT_VERSION).toMatch(/^diary-brain-v\d+$/u);
  });
});
