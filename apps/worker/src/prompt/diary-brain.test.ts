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
    expect(DIARY_BRAIN_PROMPT_VERSION).toBe("diary-brain-v6");
  });

  it("属性マスタと明言のみ保存する境界を含む", () => {
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("occupation (identity)");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("職業から勤務形態など別属性を補完しない");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("本人が明言した独立した命題だけを候補");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain("特定の相手について事実や観察を明言");
    expect(DIARY_BRAIN_SYSTEM_PROMPT).toContain(
      "本人の発言を越えて性格、勤務事情、内心を補完しない",
    );
  });
});
