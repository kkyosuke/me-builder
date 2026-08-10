// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSettingsScreen } from "./profile-settings-screen";

describe("ProfileSettingsScreen", () => {
  afterEach(cleanup);

  it("未設定のアバターと現在の表示テーマを確認できる", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "プロフィール" })).toBeTruthy();
    expect(screen.getByText("未設定")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "表示テーマ" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /ダーク/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("アバター設定とテーマ変更をそれぞれ通知する", () => {
    const onOpenAvatar = vi.fn();
    const onThemeChange = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={{ id: "avatar-1", src: "blob:avatar-1" }}
        theme="dark"
        onBack={vi.fn()}
        onOpenAvatar={onOpenAvatar}
        onThemeChange={onThemeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /アバターを変更/ }));
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));

    expect(onOpenAvatar).toHaveBeenCalledOnce();
    expect(onThemeChange).toHaveBeenCalledWith("light");
  });

  it("アバター候補の生成中であることをプロフィールにも表示する", () => {
    const onOpenAvatar = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        avatarJobStatus="generating"
        theme="dark"
        onBack={vi.fn()}
        onOpenAvatar={onOpenAvatar}
        onThemeChange={vi.fn()}
      />,
    );

    const avatarButton = screen.getByRole("button", { name: /アバターを生成中/ });
    expect(screen.getByText("完了すると、ここから候補を選べます")).toBeTruthy();
    expect(avatarButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(avatarButton);
    expect(onOpenAvatar).not.toHaveBeenCalled();
  });

  it("候補完成時はアバターから候補選択を開ける", () => {
    const onOpenAvatar = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        avatarJobStatus="ready"
        theme="dark"
        onBack={vi.fn()}
        onOpenAvatar={onOpenAvatar}
        onThemeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /候補ができました/ }));
    expect(screen.getByText("タップして候補を選んでください")).toBeTruthy();
    expect(onOpenAvatar).toHaveBeenCalledOnce();
  });

  it("管理者だけに管理者画面へのリンクを表示する", () => {
    const { rerender } = render(
      <ProfileSettingsScreen
        avatar={null}
        isAdmin={false}
        theme="dark"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: /管理者画面を開く/ })).toBeNull();

    rerender(
      <ProfileSettingsScreen
        avatar={null}
        isAdmin
        theme="dark"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: /管理者画面を開く/ }).getAttribute("href")).toBe(
      "/admin",
    );
  });
});
