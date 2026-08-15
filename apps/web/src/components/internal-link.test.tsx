// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalLink } from "./internal-link";

const mocks = vi.hoisted(() => ({ preloadMainApplication: vi.fn() }));

vi.mock("../routes", () => ({ preloadMainApplication: mocks.preloadMainApplication }));

describe("InternalLink", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.clearAllMocks();
  });

  it("通常クリックでは文書を再読み込みせず履歴と表示ルートを更新する", () => {
    window.history.replaceState({}, "", "/compatibility");
    const handlePopState = vi.fn();
    window.addEventListener("popstate", handlePopState);
    render(<InternalLink href="/me?shareCategory=family">わたし</InternalLink>);

    expect(fireEvent.click(screen.getByRole("link", { name: "わたし" }))).toBe(false);
    expect(window.location.pathname + window.location.search).toBe("/me?shareCategory=family");
    expect(handlePopState).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", handlePopState);
  });

  it("修飾キー付きクリックはブラウザの標準動作へ委ねる", () => {
    window.history.replaceState({}, "", "/compatibility");
    const delegatedToBrowser = vi.fn();
    const preventNavigation = (event: MouseEvent) => {
      delegatedToBrowser(!event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", preventNavigation);
    render(<InternalLink href="/me">わたし</InternalLink>);

    fireEvent.click(screen.getByRole("link", { name: "わたし" }), { metaKey: true });
    expect(delegatedToBrowser).toHaveBeenCalledWith(true);
    expect(window.location.pathname).toBe("/compatibility");
    document.removeEventListener("click", preventNavigation);
  });

  it("移動意図を検知した時に遷移先を先読みする", () => {
    const onPreload = vi.fn();
    render(
      <InternalLink
        href="/diagnosis?category=friend"
        onPreload={onPreload}
        preloadRoute="diagnosis"
      >
        診断
      </InternalLink>,
    );
    const link = screen.getByRole("link", { name: "診断" });

    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    expect(onPreload).toHaveBeenCalledTimes(2);
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(1, "diagnosis");
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(2, "diagnosis");
  });
});
