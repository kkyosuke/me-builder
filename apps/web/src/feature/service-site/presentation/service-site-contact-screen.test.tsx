// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSiteContactScreen } from "./service-site-contact-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSiteContactScreen", () => {
  it("未確定の窓口を創作せず、受付状態・種別・安全上の注意を示す", () => {
    render(<ServiceSiteContactScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "お問い合わせ" })).toBeTruthy();
    expect(screen.getByText("窓口準備中")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /この画面からお問い合わせは送信できません/ }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "データとプライバシー" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("有効な窓口の公開までは検索対象外にする", () => {
    render(<ServiceSiteContactScreen />);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/contact",
    );
  });
});
