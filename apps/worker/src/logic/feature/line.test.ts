import { describe, expect, it } from "vitest";
import { buildReplyText, classifyLineText } from "./line";

const LIFF_ID = "1234567890-abcdefgh";
const DIARY_TEXT = "今日は散歩をして、久しぶりに本を読んだ。";

describe("classifyLineText", () => {
  it("診断キーワードを表記ゆれ込みの完全一致で判定する", () => {
    for (const text of ["診断", "しんだん", "　今日のしんだん　", "きょうの診断"]) {
      expect(classifyLineText(text)).toBe("diagnosis-request");
    }
  });

  it("キーワードを含む文章とAI接頭辞も日記として扱う", () => {
    expect(classifyLineText("今日は会社で診断に答えた")).toBe("diary");
    expect(classifyLineText("AI: 今日の気持ちを整理して")).toBe("diary");
    expect(classifyLineText(DIARY_TEXT)).toBe("diary");
  });
});

describe("buildReplyText", () => {
  it("診断要求にはLIFFリンクだけを返す", () => {
    expect(buildReplyText("診断", LIFF_ID)).toBe(
      `今日の診断に答える\nhttps://liff.line.me/${LIFF_ID}`,
    );
  });

  it("日記には受付とfinalを待つ案内を返し、本文をオウム返ししない", () => {
    const result = buildReplyText(DIARY_TEXT, LIFF_ID);
    expect(result).toContain("受け付けました");
    expect(result).toContain("少し考えてから返事をするね");
    expect(result).toContain(`https://liff.line.me/${LIFF_ID}`);
    expect(result).not.toContain(DIARY_TEXT);
  });
});
