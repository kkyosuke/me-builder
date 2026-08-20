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
  });

  it("正式公開した正本を検索対象にする", () => {
    render(<ServiceSitePrivacyScreen />);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "index,follow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/privacy",
    );
  });
});
