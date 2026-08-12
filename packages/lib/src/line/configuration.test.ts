import { describe, expect, it } from "vitest";
import { resolveLiffConfiguration } from "./configuration";

describe("resolveLiffConfiguration", () => {
  it("LIFF IDの接頭辞からLINE LoginチャネルIDを補完する", () => {
    expect(resolveLiffConfiguration({ liffId: "2010850319-Yl63upAR" })).toEqual({
      liffId: "2010850319-Yl63upAR",
      lineLoginChannelId: "2010850319",
    });
  });

  it("明示したチャネルIDがLIFF IDの接頭辞と一致すれば受け入れる", () => {
    expect(
      resolveLiffConfiguration({
        liffId: "2010850319-Yl63upAR",
        lineLoginChannelId: "2010850319",
      }),
    ).toEqual({ liffId: "2010850319-Yl63upAR", lineLoginChannelId: "2010850319" });
  });

  it.each(["invalid", "abc-def", "123-", "123-a_b"])("不正なLIFF ID %sを拒否する", (liffId) => {
    expect(() => resolveLiffConfiguration({ liffId })).toThrow("LIFF_ID");
  });

  it("明示したチャネルIDとLIFF IDの接頭辞が不一致なら拒否する", () => {
    expect(() =>
      resolveLiffConfiguration({
        liffId: "2010850319-Yl63upAR",
        lineLoginChannelId: "9999999999",
      }),
    ).toThrow("must match");
  });

  it("数字以外を含む明示チャネルIDを拒否する", () => {
    expect(() => resolveLiffConfiguration({ lineLoginChannelId: "channel-id" })).toThrow(
      "decimal digits",
    );
  });
});
