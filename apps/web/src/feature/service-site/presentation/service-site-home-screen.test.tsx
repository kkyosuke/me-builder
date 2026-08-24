// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSiteHomeScreen } from "./service-site-home-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSiteHomeScreen", () => {
  it("サービスの価値、安全性、利用開始方法を最初の画面で伝える", () => {
    render(<ServiceSiteHomeScreen />);

    expect(screen.getByRole("heading", { level: 1, name: /答えるたび/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "友だち追加" })[0]?.getAttribute("href")).toBe(
      "https://lin.ee/YezPSYA",
    );
    expect(screen.getByText("入力した内容は、初期状態で他の利用者へ公開されません。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "記録する。見つける。振り返る。" })).toBeTruthy();
  });

  it("公開ページ用の検索メタデータを設定する", () => {
    render(<ServiceSiteHomeScreen />);

    expect(document.title).toBe("かがみ｜日記と診断で、自分を少しずつ知る");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "index,follow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/",
    );
  });

  it("現在は誰でも無料と表示し、有料Plan・価格・trialを掲載しない", () => {
    render(<ServiceSiteHomeScreen />);

    expect(screen.getByRole("heading", { name: "現在は無料で利用できます。" })).toBeTruthy();
    expect(screen.getAllByText(/どなたでも無料で利用できます/u).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Lite|Full|ファミリーパック/u)).toBeNull();
    expect(screen.queryByText(/有料契約|Customer Portal|期間末解約|￥|トライアル/u)).toBeNull();
  });

  it("LINE Account復旧の実装済み範囲と事前コードがない場合の境界を説明する", () => {
    render(<ServiceSiteHomeScreen />);

    expect(screen.getByText(/本人向け画面に表示された一回限りの復旧コード/u)).toBeTruthy();
    expect(
      screen.getByText(/問い合わせを復旧コードの代わりにして、同じAccountへ再接続/u),
    ).toBeTruthy();
    expect(screen.queryByText(/現在の仕組みでは、Accountを復旧できないことがあります/u)).toBeNull();
  });
});
