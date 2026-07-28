import { describe, expect, it } from "vitest";
import { buildReplyText, classifyLineText } from "./line";

const LIFF_ID = "1234567890-abcdefgh";
const DIARY_TEXT = "今日は散歩をして、久しぶりに本を読んだ。";

describe("classifyLineText", () => {
  it("「アンケート」をアンケートの要求として扱うこと", () => {
    expect(classifyLineText("アンケート")).toBe("survey-request");
  });

  it("表記ゆれを吸収すること", () => {
    // 半角カナ・ひらがな・全角スペース・前後の空白はすべて同じ意図として扱う
    expect(classifyLineText("ｱﾝｹｰﾄ")).toBe("survey-request");
    expect(classifyLineText("あんけーと")).toBe("survey-request");
    expect(classifyLineText("  アンケート ")).toBe("survey-request");
    expect(classifyLineText("　アンケート　")).toBe("survey-request");
    expect(classifyLineText("今日のアンケート")).toBe("survey-request");
    expect(classifyLineText("きょうのアンケート")).toBe("survey-request");
  });

  it("キーワードを含むだけの文章は日記として扱うこと", () => {
    // 部分一致にすると、記録されるべき日記がコマンドとして飲み込まれてしまう
    expect(classifyLineText("今日は会社でアンケートに答えた")).toBe("diary");
    expect(classifyLineText("アンケートってどこから答えるの？")).toBe("diary");
  });

  it("通常のテキストは日記として扱うこと", () => {
    expect(classifyLineText(DIARY_TEXT)).toBe("diary");
    expect(classifyLineText("")).toBe("diary");
  });
});

describe("buildReplyText", () => {
  describe("アンケートを求められたとき", () => {
    it("受け付けた旨は付けず、アンケートの LIFF リンクだけを返すこと", () => {
      const text = buildReplyText("アンケート", LIFF_ID);

      expect(text).toContain("今日のアンケートに答える");
      expect(text).toContain(`https://liff.line.me/${LIFF_ID}`);
      expect(text).not.toContain("受け付けました。");
    });

    it("LIFF ID が未設定ならリンクを出さず案内だけを返すこと", () => {
      const text = buildReplyText("アンケート", undefined);

      expect(text).not.toContain("liff.line.me");
      expect(text).toContain("いまはアンケートのリンクをお渡しできません。");
    });
  });

  describe("日記が送られたとき", () => {
    it("LIFF ID が設定されていれば従来どおり受け付けた旨とリンクを返すこと", () => {
      const text = buildReplyText(DIARY_TEXT, LIFF_ID);

      expect(text).toBe(
        `受け付けました。\n今日のアンケートに答える\nhttps://liff.line.me/${LIFF_ID}`,
      );
    });

    it("LIFF ID が未設定なら受け付けた旨だけを返しリンクを含めないこと", () => {
      const text = buildReplyText(DIARY_TEXT, undefined);

      expect(text).toBe("受け付けました。");
      expect(text).not.toContain("liff.line.me");
    });

    it("送られた本文をオウム返ししないこと", () => {
      expect(buildReplyText(DIARY_TEXT, LIFF_ID)).not.toContain(DIARY_TEXT);
    });
  });

  it("LIFF の URL は liff.line.me 配下で LIFF ID をそのまま使うこと", () => {
    // LINE 内で開くには liff.line.me/{liffId} である必要があり、Web の URL では LINE 内で開かない
    const texts = [buildReplyText(DIARY_TEXT, LIFF_ID), buildReplyText("アンケート", LIFF_ID)];

    for (const text of texts) {
      expect(text).toMatch(/^https:\/\/liff\.line\.me\/1234567890-abcdefgh$/m);
    }
  });
});
