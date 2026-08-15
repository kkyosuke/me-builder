// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootApplication } from "./root-application";

vi.mock("./App", () => ({
  App: () => <main>本人向けアプリ</main>,
}));

vi.mock("./feature/service-site", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./feature/service-site")>();
  return {
    ...actual,
    ServiceSiteApplication: () => <main>サービス紹介トップ</main>,
  };
});

describe("RootApplication", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(cleanup);

  it("ルートでは認証前のサービス紹介サイトを表示する", async () => {
    render(<RootApplication />);

    expect(await screen.findByText("サービス紹介トップ")).toBeTruthy();
    expect(screen.queryByText("本人向けアプリ")).toBeNull();
  });

  it("アプリpathnameでは本人向けアプリを表示し、検索対象外にする", async () => {
    window.history.replaceState({}, "", "/diagnosis");
    render(<RootApplication />);

    expect(await screen.findByText("本人向けアプリ")).toBeTruthy();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
  });

  it("LIFF deep linkの要求pathnameを公開ルートより優先する", async () => {
    window.history.replaceState({}, "", "/app?liff.state=%2Fme");
    render(<RootApplication />);

    expect(await screen.findByText("本人向けアプリ")).toBeTruthy();
  });

  it("LIFFの共通endpointでは本人向けアプリを表示する", async () => {
    window.history.replaceState({}, "", "/app");
    render(<RootApplication />);

    expect(await screen.findByText("本人向けアプリ")).toBeTruthy();
  });
});
