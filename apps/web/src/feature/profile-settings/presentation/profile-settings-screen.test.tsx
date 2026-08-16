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
        serviceTermsAcceptanceHistory={<p>同意履歴の内容</p>}
      />,
    );

    expect(screen.getByRole("heading", { name: "プロフィール" })).toBeTruthy();
    expect(screen.getByText("未設定")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "表示テーマ" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /ダーク/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radiogroup", { name: "文字サイズ" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /利用規約を確認/ }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(screen.getByText("同意履歴の内容")).toBeTruthy();
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

  it("本人がプロフィールから契約管理を開き、反映待ちなら理由を確認できる", async () => {
    const onOpenBillingPortal = vi
      .fn()
      .mockRejectedValue(
        new Error("管理できる契約がまだありません。契約反映後に再試行してください。"),
      );
    render(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onOpenBillingPortal={onOpenBillingPortal}
        entitlement={{
          status: "success",
          data: {
            status: "active",
            plan: "lite",
            source: "subscription",
            effectiveAt: "2026-08-01T00:00:00.000Z",
            availableUntil: "2026-09-01T00:00:00.000Z",
            aiReply: {
              limit: 150,
              used: 0,
              reserved: 0,
              remaining: 150,
              periodStartsAt: "2026-08-01T00:00:00.000Z",
              resetsAt: "2026-09-01T00:00:00.000Z",
            },
            profileSummary: {
              limit: 4,
              used: 0,
              reserved: 0,
              remaining: 4,
              periodStartsAt: "2026-08-01T00:00:00.000Z",
              resetsAt: "2026-09-01T00:00:00.000Z",
            },
          },
        }}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /契約を管理/ }));
    expect(screen.getByText("支払方法、請求履歴、解約を確認")).toBeTruthy();
    expect(screen.queryByText(/プラン変更/)).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "管理できる契約がまだありません",
    );
    expect(onOpenBillingPortal).toHaveBeenCalledOnce();
  });

  it("現在Planから料金プラン画面を開く", () => {
    const onOpenBillingPlans = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        entitlement={{
          status: "success",
          data: {
            status: "free",
            plan: "free",
            source: "free",
            effectiveAt: "2026-08-16T00:00:00.000Z",
            availableUntil: null,
            aiReply: {
              limit: 20,
              used: 0,
              reserved: 0,
              remaining: 20,
              periodStartsAt: "2026-08-16T00:00:00.000Z",
              resetsAt: "2026-09-16T00:00:00.000Z",
            },
            profileSummary: {
              limit: 1,
              used: 0,
              reserved: 0,
              remaining: 1,
              periodStartsAt: "2026-08-16T00:00:00.000Z",
              resetsAt: "2026-11-14T00:00:00.000Z",
            },
          },
        }}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onOpenBillingPlans={onOpenBillingPlans}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /契約を管理/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "プランをアップグレードする" }));
    expect(onOpenBillingPlans).toHaveBeenCalledOnce();
  });

  it("本人入力データの確認画面を開く", () => {
    const onOpenPersonalData = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onOpenPersonalData={onOpenPersonalData}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /入力データを確認・訂正・削除/ }));
    expect(onOpenPersonalData).toHaveBeenCalledOnce();
  });

  it("未接続のSSOを現在のAccountへ追加できる", () => {
    const onLinkSsoIdentity = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
        ssoIdentity={{ status: "success", data: { linked: false, canUnlink: false } }}
        onLinkSsoIdentity={onLinkSsoIdentity}
        onUnlinkSsoIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText(/現在のAccountへSSOを追加/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SSOを接続" }));
    expect(onLinkSsoIdentity).toHaveBeenCalledOnce();
  });

  it("別のログイン方法がある場合だけSSOを解除する", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onUnlinkSsoIdentity = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
        ssoIdentity={{ status: "success", data: { linked: true, canUnlink: true } }}
        onLinkSsoIdentity={vi.fn()}
        onUnlinkSsoIdentity={onUnlinkSsoIdentity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "SSO接続を解除" }));
    expect(await screen.findByText("SSOを解除しました。")).toBeTruthy();
    expect(onUnlinkSsoIdentity).toHaveBeenCalledOnce();

    rerender(
      <ProfileSettingsScreen
        avatar={null}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
        ssoIdentity={{ status: "success", data: { linked: true, canUnlink: false } }}
        onLinkSsoIdentity={vi.fn()}
        onUnlinkSsoIdentity={onUnlinkSsoIdentity}
      />,
    );
    expect(screen.getByText("最後のログイン方法は解除できません。")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "SSO接続を解除" }) as HTMLButtonElement).disabled,
    ).toBe(true);
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
    const onOpenAdmin = vi.fn();
    const { rerender } = render(
      <ProfileSettingsScreen
        avatar={null}
        isAdmin={false}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAdmin={onOpenAdmin}
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
        onOpenAdmin={onOpenAdmin}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    const adminLink = screen.getByRole("link", { name: /管理者画面を開く/ });
    expect(adminLink.getAttribute("href")).toBe("/admin");
    fireEvent.click(adminLink);
    expect(onOpenAdmin).toHaveBeenCalledOnce();
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

  it("開発環境ではBrain Item一覧へのリンクを表示する", () => {
    const onOpenBrainItems = vi.fn();
    render(
      <ProfileSettingsScreen
        avatar={null}
        canOpenBrainItems
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onOpenBrainItems={onOpenBrainItems}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: /Brain Item一覧を開く/ });
    expect(link.getAttribute("href")).toBe("/profile/brain-items");
    fireEvent.click(link);
    expect(onOpenBrainItems).toHaveBeenCalledOnce();
  });

  it("契約Plan、利用可能期限、AI上限と残量を本人へ表示する", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        entitlement={{
          status: "success",
          data: {
            status: "active",
            plan: "lite",
            source: "subscription",
            effectiveAt: "2026-08-01T00:00:00.000Z",
            availableUntil: "2027-08-01T00:00:00.000Z",
            aiReply: {
              limit: 150,
              used: 10,
              reserved: 1,
              remaining: 139,
              periodStartsAt: "2026-08-01T00:00:00.000Z",
              resetsAt: "2026-09-01T00:00:00.000Z",
            },
            profileSummary: {
              limit: 4,
              used: 1,
              reserved: 0,
              remaining: 3,
              periodStartsAt: "2026-08-01T00:00:00.000Z",
              resetsAt: "2026-09-01T00:00:00.000Z",
            },
          },
        }}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "利用プラン" })).toBeTruthy();
    expect(screen.getByText("Lite")).toBeTruthy();
    expect(screen.getByText("残り 139 / 150")).toBeTruthy();
    expect(screen.getByText("残り 3 / 4")).toBeTruthy();
    expect(screen.getByText("利用可能期限")).toBeTruthy();
    expect(screen.getByText("2027/08/01")).toBeTruthy();
    expect(screen.queryByText("2026/09/01")).toBeNull();
  });

  it("料金プラン画面から戻ると起点のボタンへフォーカスを戻す", () => {
    const props = {
      avatar: null,
      entitlement: {
        status: "success" as const,
        data: {
          status: "free" as const,
          plan: "free" as const,
          source: "free" as const,
          effectiveAt: "2026-08-16T00:00:00.000Z",
          availableUntil: null,
          aiReply: {
            limit: 20,
            used: 0,
            reserved: 0,
            remaining: 20,
            periodStartsAt: "2026-08-16T00:00:00.000Z",
            resetsAt: "2026-09-16T00:00:00.000Z",
          },
          profileSummary: {
            limit: 1,
            used: 0,
            reserved: 0,
            remaining: 1,
            periodStartsAt: "2026-08-16T00:00:00.000Z",
            resetsAt: "2026-11-14T00:00:00.000Z",
          },
        },
      },
      theme: "dark" as const,
      fontSize: "medium" as const,
      onBack: vi.fn(),
      onOpenAvatar: vi.fn(),
      onOpenBillingPlans: vi.fn(),
      onThemeChange: vi.fn(),
      onFontSizeChange: vi.fn(),
    };
    const { rerender } = render(
      <ProfileSettingsScreen {...props} isInactive inactiveFocusTarget="billing" />,
    );

    rerender(<ProfileSettingsScreen {...props} isInactive={false} inactiveFocusTarget="billing" />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "プランをアップグレードする" }),
    );
  });

  it("Free Planでは契約期限ではなくAI利用枠のリセット日を表示する", () => {
    render(
      <ProfileSettingsScreen
        avatar={null}
        entitlement={{
          status: "success",
          data: {
            status: "free",
            plan: "free",
            source: "free",
            effectiveAt: "2026-08-01T00:00:00.000Z",
            availableUntil: null,
            aiReply: {
              limit: 20,
              used: 0,
              reserved: 0,
              remaining: 20,
              periodStartsAt: "2026-08-01T00:00:00.000Z",
              resetsAt: "2026-09-01T00:00:00.000Z",
            },
            profileSummary: {
              limit: 1,
              used: 0,
              reserved: 0,
              remaining: 1,
              periodStartsAt: "2026-07-30T00:00:00.000Z",
              resetsAt: "2026-10-28T00:00:00.000Z",
            },
          },
        }}
        theme="dark"
        fontSize="medium"
        onBack={vi.fn()}
        onOpenAvatar={vi.fn()}
        onThemeChange={vi.fn()}
        onFontSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("AI利用枠リセット")).toBeTruthy();
    expect(screen.getByText("2026/09/01")).toBeTruthy();
    expect(screen.queryByText("利用可能期限")).toBeNull();
  });
});
