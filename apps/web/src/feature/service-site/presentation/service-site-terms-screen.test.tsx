// @vitest-environment jsdom

import { currentServiceTerms } from "@me-builder/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSiteTermsScreen } from "./service-site-terms-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSiteTermsScreen", () => {
  it("共有パッケージの現在の規約本文と版を認証なしで表示する", () => {
    render(<ServiceSiteTermsScreen />);

    expect(screen.getByRole("heading", { level: 1, name: currentServiceTerms.title })).toBeTruthy();
    expect(screen.getByText(currentServiceTerms.version)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: currentServiceTerms.sections[0].heading }),
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /同意/ })).toBeNull();
  });

  it("利用規約固有のcanonical URLを設定する", () => {
    render(<ServiceSiteTermsScreen />);

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/terms",
    );
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
  });

  it("利用開始はLINE公式アカウントの友だち追加へ案内する", () => {
    render(<ServiceSiteTermsScreen />);

    expect(screen.getByRole("link", { name: "友だち追加" }).getAttribute("href")).toBe(
      "https://lin.ee/YezPSYA",
    );
  });
});
