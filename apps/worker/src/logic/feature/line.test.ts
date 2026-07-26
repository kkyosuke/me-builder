import { describe, expect, it } from "vitest";
import { buildReplyText } from "./line";

describe("buildReplyText", () => {
  it("LIFF ID が設定されていればアンケートへの LIFF リンクを添えること", () => {
    const text = buildReplyText("1234567890-abcdefgh");

    expect(text).toContain("受け付けました。");
    expect(text).toContain("https://liff.line.me/1234567890-abcdefgh");
  });

  it("LIFF ID が未設定なら受け付けた旨だけを返しリンクを含めないこと", () => {
    const text = buildReplyText(undefined);

    expect(text).toBe("受け付けました。");
    expect(text).not.toContain("liff.line.me");
  });

  it("LIFF の URL は liff.line.me 配下で LIFF ID をそのまま使うこと", () => {
    // LINE 内で開くには liff.line.me/{liffId} である必要があり、Web の URL では LINE 内で開かない
    expect(buildReplyText("1234567890-abcdefgh")).toMatch(
      /^https:\/\/liff\.line\.me\/1234567890-abcdefgh$/m,
    );
  });
});
