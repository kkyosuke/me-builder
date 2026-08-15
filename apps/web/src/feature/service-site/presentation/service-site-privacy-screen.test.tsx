// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSitePrivacyScreen } from "./service-site-privacy-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSitePrivacyScreen", () => {
  it("法務正本を装わず、公開準備中の状態と確定項目を示す", () => {
    render(<ServiceSitePrivacyScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "プライバシーポリシー" })).toBeTruthy();
    expect(screen.getByText("公開準備中")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /正式なプライバシーポリシーではありません/ }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "外部送信" })).toBeTruthy();
  });

  it("正式公開までは検索対象外にする", () => {
    render(<ServiceSitePrivacyScreen />);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/privacy",
    );
  });
});
