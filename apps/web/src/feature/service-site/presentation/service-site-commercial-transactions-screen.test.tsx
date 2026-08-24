// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSiteCommercialTransactionsScreen } from "./service-site-commercial-transactions-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSiteCommercialTransactionsScreen", () => {
  it("Free限定中は旧直リンクでも有料Planの条件を表示しない", () => {
    render(<ServiceSiteCommercialTransactionsScreen />);

    expect(
      screen.getByRole("heading", { level: 1, name: "現在は無料で利用できます" }),
    ).toBeTruthy();
    expect(screen.getByText(/有料Planの一般提供は行っていません/u)).toBeTruthy();
    expect(screen.queryByText(/Lite|Full|ファミリーパック/u)).toBeNull();
    expect(screen.queryByText(/月額|年額|トライアル|自動更新|返金/u)).toBeNull();
  });

  it("固有URLを検索対象外にする", () => {
    render(<ServiceSiteCommercialTransactionsScreen />);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/commercial-transactions",
    );
  });
});
