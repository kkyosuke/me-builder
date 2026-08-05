import { describe, expect, it } from "vitest";
import { buildAiReplyText, buildReplyText, classifyLineText, extractAiPrompt } from "./line";

const LIFF_ID = "1234567890-abcdefgh";
const DIARY_TEXT = "今日は散歩をして、久しぶりに本を読んだ。";

describe("classifyLineText", () => {
  it("「診断」を診断の要求として扱うこと", () => {
    expect(classifyLineText("診断")).toBe("diagnosis-request");
  });

  it("表記ゆれを吸収すること", () => {
    // ひらがな・全角スペース・前後の空白はすべて同じ意図として扱う
    expect(classifyLineText("しんだん")).toBe("diagnosis-request");
    expect(classifyLineText("  診断 ")).toBe("diagnosis-request");
    expect(classifyLineText("　診断　")).toBe("diagnosis-request");
    expect(classifyLineText("今日の診断")).toBe("diagnosis-request");
    expect(classifyLineText("今日のしんだん")).toBe("diagnosis-request");
    expect(classifyLineText("きょうの診断")).toBe("diagnosis-request");
    expect(classifyLineText("きょうのしんだん")).toBe("diagnosis-request");
  });

  it("キーワードを含むだけの文章は日記として扱うこと", () => {
    // 部分一致にすると、記録されるべき日記がコマンドとして飲み込まれてしまう
    expect(classifyLineText("今日は会社で診断に答えた")).toBe("diary");
    expect(classifyLineText("診断ってどこから答えるの？")).toBe("diary");
  });

  it("通常のテキストは日記として扱うこと", () => {
    expect(classifyLineText(DIARY_TEXT)).toBe("diary");
    expect(classifyLineText("")).toBe("diary");
  });

  it("`AI:` で始まるテキストをAIチャットとして扱うこと", () => {
    expect(classifyLineText("AI: こんにちは")).toBe("ai-chat");
    expect(classifyLineText("ai：今日の天気を教えて")).toBe("ai-chat");
  });
});

describe("extractAiPrompt", () => {
  it("接頭辞を除いた質問を返し、通常のテキストには反応しないこと", () => {
    expect(extractAiPrompt("AI:  こんにちは ")).toBe("こんにちは");
    expect(extractAiPrompt("ai：今日の天気を教えて")).toBe("今日の天気を教えて");
    expect(extractAiPrompt(DIARY_TEXT)).toBeUndefined();
  });
});

describe("buildAiReplyText", () => {
  it("応答を整形し、LINEの上限へ収めること", () => {
    expect(buildAiReplyText("  Geminiからの返信  ")).toBe("Geminiからの返信");
    expect(buildAiReplyText("a".repeat(5001))).toHaveLength(5000);
    expect(buildAiReplyText("🍎".repeat(2501))).toHaveLength(5000);
    expect(buildAiReplyText("  ")).toBeUndefined();
  });
});

describe("buildReplyText", () => {
  describe("診断を求められたとき", () => {
    it("受け付けた旨は付けず、診断の LIFF リンクだけを返すこと", () => {
      const text = buildReplyText("診断", LIFF_ID);

      expect(text).toContain("今日の診断に答える");
      expect(text).toContain(`https://liff.line.me/${LIFF_ID}`);
      expect(text).not.toContain("受け付けました。");
    });

    it("LIFF ID が未設定ならリンクを出さず案内だけを返すこと", () => {
      const text = buildReplyText("診断", undefined);

      expect(text).not.toContain("liff.line.me");
      expect(text).toContain("いまは診断のリンクをお渡しできません。");
    });
  });

  describe("日記が送られたとき", () => {
    it("LIFF ID が設定されていれば従来どおり受け付けた旨とリンクを返すこと", () => {
      const text = buildReplyText(DIARY_TEXT, LIFF_ID);

      expect(text).toBe(`受け付けました。\n今日の診断に答える\nhttps://liff.line.me/${LIFF_ID}`);
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

  describe("AIチャットが送られたとき", () => {
    it("質問が空なら入力方法を案内すること", () => {
      expect(buildReplyText("AI:", LIFF_ID)).toContain("`AI:` の後に質問");
    });

    it("AI接続が利用できない場合の案内を返すこと", () => {
      expect(buildReplyText("AI: こんにちは", LIFF_ID)).toContain("いまはAIに接続できません");
    });
  });

  it("LIFF の URL は liff.line.me 配下で LIFF ID をそのまま使うこと", () => {
    // LINE 内で開くには liff.line.me/{liffId} である必要があり、Web の URL では LINE 内で開かない
    const texts = [buildReplyText(DIARY_TEXT, LIFF_ID), buildReplyText("診断", LIFF_ID)];

    for (const text of texts) {
      expect(text).toMatch(/^https:\/\/liff\.line\.me\/1234567890-abcdefgh$/m);
    }
  });
});
