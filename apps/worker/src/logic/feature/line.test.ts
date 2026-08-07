import { describe, expect, it } from "vitest";
import { appendDiagnosisLink, buildDiagnosisReplyText, classifyLineText } from "./line";

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

describe("LINE reply formatting", () => {
  it("診断要求にはLIFFリンクだけを返す", () => {
    expect(buildDiagnosisReplyText(LIFF_ID)).toBe(
      `今日の診断に答える\nhttps://liff.line.me/${LIFF_ID}`,
    );
  });

  it("AI回答の末尾にLIFFリンクを付ける", () => {
    expect(appendDiagnosisLink("返事です。", LIFF_ID)).toBe(
      `返事です。\n\n今日の診断に答える\nhttps://liff.line.me/${LIFF_ID}`,
    );
  });

  it("LIFF IDがなければAI回答を変更しない", () => {
    expect(appendDiagnosisLink("返事です。")).toBe("返事です。");
  });

  it("LINEの文字数上限内でAI回答を調整し、末尾のリンクを残す", () => {
    const formatted = appendDiagnosisLink("😊".repeat(5_000), LIFF_ID);

    expect(Array.from(formatted)).toHaveLength(5_000);
    expect(formatted.endsWith(`\n\n今日の診断に答える\nhttps://liff.line.me/${LIFF_ID}`)).toBe(
      true,
    );
  });
});
