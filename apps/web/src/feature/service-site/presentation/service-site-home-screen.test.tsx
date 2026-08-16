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

  it("共通のPlanマッピングから機能比較を表示する", () => {
    render(<ServiceSiteHomeScreen />);

    const comparison = screen.getByRole("table", { name: "プランごとの機能と利用範囲" });
    expect(comparison.textContent).toContain("AIによる意味検索");
    expect(comparison.textContent).toContain("直近30日");
    expect(comparison.textContent).toContain("直近1年");
    expect(comparison.textContent).toContain("保存されている全期間");
    expect(screen.getByRole("columnheader", { name: "ファミリーパック" })).toBeTruthy();
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
});
