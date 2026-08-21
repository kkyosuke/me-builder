import { describe, expect, it } from "vitest";
import { commercialTransactionsDisclosure } from "./commercial-transactions";

describe("commercialTransactionsDisclosure", () => {
  it("購入前に必要な課金条件と非公開事業者情報の請求方法を固定する", () => {
    const text = commercialTransactionsDisclosure.entries
      .map(({ label, value }) => `${label}:${value}`)
      .join("\n");

    expect(text).toContain("購入の判断に先立って遅滞なく");
    expect(text).toContain("14日間");
    expect(text).toContain("開始時に決済手段を登録");
    expect(text).toContain("利用者都合による返金は行いません");
    expect(text).toContain("適格請求書は発行しません");
    expect(text).toContain("LINEには表示しません");
  });

  it("公開文書へ事業者の個人連絡先を埋め込まない", () => {
    const serialized = JSON.stringify(commercialTransactionsDisclosure);

    expect(serialized).not.toMatch(/\d{2,4}-\d{2,4}-\d{3,4}/);
    expect(serialized).not.toContain("〒");
  });
});
