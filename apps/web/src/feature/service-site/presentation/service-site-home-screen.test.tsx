// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("Freeを含む料金プランと利用できる機能を表示する", () => {
    render(<ServiceSiteHomeScreen />);

    expect(screen.getByRole("heading", { name: "自分に合う続け方を選べます。" })).toBeTruthy();
    expect(screen.getByText("￥780")).toBeTruthy();
    expect(screen.getByText("￥1,480")).toBeTruthy();
    expect(screen.getByText("￥2,980")).toBeTruthy();
    expect(
      screen.getByRole("table", {
        name: "Free、Lite、Full、ファミリーパックの機能比較",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("row", { name: /わたしのまとめ/u })).toBeNull();
    expect(screen.queryByRole("row", { name: /基本の相性シート/u })).toBeNull();
    expect(screen.queryByRole("row", { name: /2人の継続的な振り返り/u })).toBeNull();
    const aiReplyRow = screen.getByRole("row", { name: /AI返信/u });
    expect(within(aiReplyRow).getByText("月60回")).toBeTruthy();
    expect(screen.getByText(/わたしのまとめは全Plan共通で月4回まで/u)).toBeTruthy();
    expect(screen.getByText(/いずれの生成条件も満たさない場合は回数を消費せず/u)).toBeTruthy();
    expect(screen.getByText(/AIが生成して正常に届けた回答を1回として数えます/u)).toBeTruthy();
    expect(screen.getAllByText("提供準備中")).toHaveLength(6);
    expect(screen.getByText(/現在は購入できません/u)).toBeTruthy();
  });

  it("LINE Account復旧の実装済み範囲と事前コードがない場合の境界を説明する", () => {
    render(<ServiceSiteHomeScreen />);

    expect(screen.getByText(/事前に発行・保存した一回限りの復旧コード/u)).toBeTruthy();
    expect(screen.getByText(/コードがない場合は自動復旧できません/u)).toBeTruthy();
    expect(screen.getByText(/窓口の準備後にお問い合わせページで案内/u)).toBeTruthy();
    expect(screen.queryByText(/現在の仕組みでは、Accountを復旧できないことがあります/u)).toBeNull();
  });
});
