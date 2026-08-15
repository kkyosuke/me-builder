import { describe, expect, it } from "vitest";
import { buildDiagnosisReplyText, buildTermsAcceptanceReplyText, classifyLineText } from "./line";

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

  it("未同意では規約画面へのLIFFリンクと再送案内を返す", () => {
    expect(buildTermsAcceptanceReplyText(LIFF_ID)).toBe(
      `サービスを利用するには、利用規約への同意が必要です。\n内容を確認して同意したあと、メッセージをもう一度送ってください。\nhttps://liff.line.me/${LIFF_ID}/terms`,
    );
  });
});
