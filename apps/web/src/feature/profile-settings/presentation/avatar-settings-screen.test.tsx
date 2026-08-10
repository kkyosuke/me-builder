// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarSettingsScreen } from "./avatar-settings-screen";
import type { AvatarSettingsController } from "./use-avatar-settings";

function controller(overrides: Partial<AvatarSettingsController> = {}): AvatarSettingsController {
  return {
    currentAvatar: null,
    loadStatus: "ready",
    errorMessage: null,
    busy: false,
    refresh: vi.fn().mockResolvedValue(true),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("AvatarSettingsScreen", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:selected"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(cleanup);

  it("画像をプレビューしてから保存し、成功後にモーダルを閉じる", async () => {
    const state = controller();
    const onSaved = vi.fn();
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={onSaved} />);

    const saveButton = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    const file = new File(["selfie"], "selfie.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("アバター用の画像ファイルを選ぶ"), {
      target: { files: [file] },
    });

    expect(state.save).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "保存するアバター画像のプレビュー" })).toBeTruthy();
    fireEvent.click(saveButton);

    await waitFor(() => expect(state.save).toHaveBeenCalledWith(file));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByText(/画像は外部のAIサービスへ送信しません/)).toBeTruthy();
  });

  it("許可していない画像形式を送信前に拒否する", () => {
    const state = controller();
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("アバター用の画像ファイルを選ぶ"), {
      target: { files: [new File(["<svg />"], "avatar.svg", { type: "image/svg+xml" })] },
    });

    expect(screen.getByRole("alert").textContent).toContain("SVGは利用できません");
    expect(state.save).not.toHaveBeenCalled();
  });

  it("現在のアバターを削除できる", () => {
    const state = controller({
      currentAvatar: { id: "00000000-0000-4000-8000-000000000003", src: "blob:avatar" },
    });
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "現在のアバターを削除" }));
    expect(state.remove).toHaveBeenCalledOnce();
  });
});
