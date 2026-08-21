// @vitest-environment jsdom

import { commercialTransactionsDisclosure } from "@me-builder/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSiteCommercialTransactionsScreen } from "./service-site-commercial-transactions-screen";

vi.mock("../../../config", () => ({
  config: { baseUrl: "https://kagami.example.com" },
}));

afterEach(cleanup);

describe("ServiceSiteCommercialTransactionsScreen", () => {
  it("購入条件と事業者情報の個別開示導線を認証なしで表示する", () => {
    render(<ServiceSiteCommercialTransactionsScreen />);

    expect(
      screen.getByRole("heading", { level: 1, name: commercialTransactionsDisclosure.title }),
    ).toBeTruthy();
    expect(screen.getByText(/適格請求書は発行しません/)).toBeTruthy();
    expect(screen.getByText(/LINEには表示しません/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: commercialTransactionsDisclosure.contact })
        .getAttribute("href"),
    ).toContain("subject=");
  });

  it("固有のcanonical URLを設定する", () => {
    render(<ServiceSiteCommercialTransactionsScreen />);

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://kagami.example.com/commercial-transactions",
    );
  });
});
