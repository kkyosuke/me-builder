// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSitePrivacyScreen } from "./service-site-privacy-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSitePrivacyScreen", () => {
  it("最新の正式なプライバシーポリシーと確定したデータ境界を示す", () => {
    render(<ServiceSitePrivacyScreen />);

    expect(
      screen.getByRole("heading", { level: 1, name: "かがみ プライバシーポリシー" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3. 外部サービスへの送信" })).toBeTruthy();
    expect(screen.getByText(/Googleのモデル学習には利用しない/u)).toBeTruthy();
    expect(screen.getByText(/広告Cookieやアクセス解析は使用しません/u)).toBeTruthy();
    expect(screen.getByText(/bundleファイル名と行・列/u)).toBeTruthy();
    expect(screen.getByText(/自由記述のerror messageとstackは含めません/u)).toBeTruthy();
    expect(screen.getAllByText(/生年月日は取得しません/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/屋号「つきうさぎ」の河村 京介/u)).toBeTruthy();
    expect(screen.queryByText(/有料機能|購入前|年齢確認書類の提出/u)).toBeNull();
  });

  it("公開前レビュー中の正本を検索対象外にする", () => {
    render(<ServiceSitePrivacyScreen />);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/privacy",
    );
  });
});
