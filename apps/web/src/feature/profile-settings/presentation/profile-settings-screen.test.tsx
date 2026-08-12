// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSettingsScreen } from "./profile-settings-screen";

describe("ProfileSettingsScreen", () => {
  afterEach(cleanup);

  it("未設定のアバターと現在の表示設定を確認できる", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "プロフィール" })).toBeTruthy();
    expect(screen.getByText("未設定")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "表示テーマ" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /ダーク/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radiogroup", { name: "文字サイズ" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "中" }) as HTMLInputElement).checked).toBe(true);
  });

  it("LINEプロフィール画像を現在のアバターとして表示する", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        linePictureUrl="https://example.com/line-profile.jpg"
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("LINEのプロフィール画像")).toBeTruthy();
    expect(screen.getByRole("button", { name: /アバターを変更/ })).toBeTruthy();
    expect(
      document.querySelectorAll('img[src="https://example.com/line-profile.jpg"]').length,
    ).toBe(2);
  });

  it("アバター設定、テーマ変更、文字サイズ変更をそれぞれ通知する", () => {
    const onOpenAvatar = vi.fn();
    const onThemeChange = vi.fn();
    const onFontSizeChange = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={{ kind: "uploaded", dataUrl: "data:image/png;base64,avatar", fileName: "me.png" }}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={onOpenAvatar}
        onThemeChange={onThemeChange}
        onFontSizeChange={onFontSizeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /アバターを変更/ }));
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("radio", { name: "小" }));

    expect(onOpenAvatar).toHaveBeenCalledOnce();
    expect(onThemeChange).toHaveBeenCalledWith("light");
    expect(onFontSizeChange).toHaveBeenCalledWith("small");
  });

  it("アバター変更中はプロフィールを操作対象から外す", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        isInactive
        linePictureUrl="https://example.com/line-profile.jpg"
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    const dialog = document.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="profile-settings-title"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-hidden")).toBe("true");
    expect(dialog?.hasAttribute("inert")).toBe(true);
  });

  it("管理者だけに管理者画面へのリンクを表示する", () => {
    const { rerender } = render(
      <ProfileSettingsScreen
        avatar={null}
        isAdmin={false}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: /管理者画面を開く/ })).toBeNull();

    rerender(
      <ProfileSettingsScreen
        avatar={null}
        isAdmin
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: /管理者画面を開く/ }).getAttribute("href")).toBe(
      "/admin",
    );
  });

  it("プロフィール取得中はアバター操作をSkeletonに置き換える", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        isProfileLoading
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "アバターを読み込んでいます" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /アバターを設定/ })).toBeNull();
  });

  it("プロフィール取得失敗を表示して再試行を通知する", () => {
    const onRetryProfile = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        profileError="プロフィールの取得に失敗しました。"
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onRetryProfile={onRetryProfile}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("プロフィールの取得に失敗");
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetryProfile).toHaveBeenCalledOnce();
  });

  it("開発用データ操作を最下部に表示し、確認後に全削除する", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onResetAccountData = vi.fn().mockResolvedValue({
      deletedDiagnosisResponseCount: 1,
      deletedConversationSessionCount: 2,
      deletedSourceRecordCount: 3,
      deletedBrainItemCount: 4,
      deletedProfileSummaryVersionCount: 5,
      scheduledVectorDeletionCount: 6,
    });
    render(
      <ProfileSettingsScreen
        avatar={null}
        canResetAccountData
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onResetAccountData={onResetAccountData}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "自分のデータを全削除" });
    expect(button.closest("section")).toBe(document.querySelector("main section:last-child"));
    fireEvent.click(button);
    expect(await screen.findByText(/本人データを削除しました（15件）/)).toBeTruthy();
    expect(onResetAccountData).toHaveBeenCalledOnce();
  });
});
