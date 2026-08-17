// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileMenuButton } from "./profile-menu-button";

describe("ProfileMenuButton", () => {
  afterEach(cleanup);

  it.each([
    ["free", "FREE", "Free"],
    ["lite", "LITE", "Lite"],
    ["full", "FULL", "Full"],
    ["family", "FAMILY", "ファミリーパック"],
  ] as const)("%s Planを文字付きバッジで表示する", (plan, badgeLabel, accessibleLabel) => {
    render(<ProfileMenuButton avatar={null} plan={plan} onOpen={vi.fn()} onPreload={vi.fn()} />);

    const button = screen.getByRole("button", { name: "プロフィールを開く" });
    expect(button.textContent).toContain(badgeLabel);
    expect(screen.getByText(`現在のプラン: ${accessibleLabel}`)).toBeTruthy();
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("Plan未取得時は誤ったバッジを表示しない", () => {
    render(<ProfileMenuButton avatar={null} onOpen={vi.fn()} onPreload={vi.fn()} />);

    const button = screen.getByRole("button", { name: "プロフィールを開く" });
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(button.textContent).toBe("");
  });
});
