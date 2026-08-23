// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSiteContactScreen } from "./service-site-contact-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSiteContactScreen", () => {
  it("サービス運用者の有効な窓口、取扱い、安全上の注意を示す", () => {
    render(<ServiceSiteContactScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "お問い合わせ" })).toBeTruthy();
    expect(screen.getByText("メール受付")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "support@kagami.kyosuke.dev" }).getAttribute("href"),
    ).toBe("mailto:support@kagami.kyosuke.dev");
    expect(screen.getByText(/サービス運用者だけが確認/u)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "データとプライバシー" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "復旧コードがない場合" })).toBeTruthy();
    expect(
      screen.getByText(/問い合わせを復旧コードの代わりにして、同じAccountへ再接続/u),
    ).toBeTruthy();
    expect(screen.queryByText(/有料契約|Customer Portal|期間末解約/u)).toBeNull();
    expect(screen.getByText(/復旧コード、認証token/u)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("実送信レビュー前の窓口を検索対象外にする", () => {
    render(<ServiceSiteContactScreen />);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/contact",
    );
  });
});
