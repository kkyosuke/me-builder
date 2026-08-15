// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aoi, me } from "../infrastructure/compatibility-demo";
import type { CompatibilityInvitationPreview } from "../model/compatibility-invitation-preview";
import type { CompatibilityShareConsent } from "../model/compatibility-share-consent";
import { CompatibilityInvitationScreen } from "./compatibility-invitation-screen";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { CompatibilityResultScreen } from "./compatibility-result-screen";
import { CompatibilityShareScreen } from "./compatibility-share-screen";

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  values: { button?: number; clientX: number; clientY: number; pointerId: number },
) {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries({ isPrimary: true, ...values })) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

describe("Compatibility flow", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("一覧読み込み中のスケルトンカード間に余白を空ける", () => {
    render(
      <CompatibilityListScreen
        state={{ status: "loading" }}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );

    const loader = screen.getByLabelText("相性一覧を読み込み中");
    const relationships = loader.querySelector('[data-skeleton-region="relationships"]');
    expect(relationships?.querySelector(".mt-3.space-y-3")).toBeTruthy();
  });

  it("一覧の再検証失敗時は表示済みカードを残して再確認できる", () => {
    const onRefresh = vi.fn();
    render(
      <CompatibilityListScreen
        state={{
          status: "success",
          data: {
            items: [
              {
                relationshipId: "9".repeat(64),
                relationshipCategory: "partner",
                status: "accepted",
                partnerDisplayName: "あおい",
                readiness: { status: "ready", comparableThemeCount: 2 },
              },
            ],
          },
        }}
        refreshError="ネットワークに接続できません"
        onRetry={vi.fn()}
        onRefresh={onRefresh}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "あおいさん" })).toBeTruthy();
    expect(screen.getByLabelText("最新状態の確認結果").textContent).toContain(
      "表示中の内容を残しています",
    );
    fireEvent.click(screen.getByRole("button", { name: "もう一度確認" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("APIの一覧で結果あり・準備中・返事待ちを区別し、必要な操作だけを表示する", () => {
    const onCancel = vi.fn();
    const onResend = vi.fn();
    const pending = {
      relationshipId: "1".repeat(64),
      relationshipCategory: "partner" as const,
      status: "pending" as const,
      expiresAt: "2026-08-26T00:00:00.000Z",
      invitationUrl: `https://liff.line.me/test/compatibility/invitations/${"1".repeat(64)}`,
    };
    render(
      <CompatibilityListScreen
        state={{
          status: "success",
          data: {
            items: [
              pending,
              {
                relationshipId: "2".repeat(64),
                relationshipCategory: "family",
                status: "accepted",
                partnerDisplayName: "あおい",
                readiness: { status: "ready", comparableThemeCount: 3 },
              },
              {
                relationshipId: "3".repeat(64),
                relationshipCategory: "friend",
                status: "accepted",
                partnerDisplayName: "はる",
                readiness: { status: "waiting", nextAction: "diagnosis" },
              },
              {
                relationshipId: "4".repeat(64),
                relationshipCategory: "work",
                status: "accepted",
                partnerDisplayName: "なつ",
                readiness: { status: "waiting", nextAction: "profile-summary" },
              },
              {
                relationshipId: "5".repeat(64),
                relationshipCategory: "partner",
                status: "accepted",
                partnerDisplayName: "ふゆ",
                readiness: { status: "waiting", nextAction: null },
              },
            ],
          },
        }}
        onRetry={vi.fn()}
        onCancel={onCancel}
        onResend={onResend}
      />,
    );

    expect(screen.getByRole("heading", { name: "ふたりの見取り図" })).toBeTruthy();
    expect(screen.getByText("結果あり")).toBeTruthy();
    expect(screen.getByText("3つのテーマで比較できます")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "準備中" })).toBeTruthy();
    expect(screen.getAllByText("あなたの準備待ち")).toHaveLength(2);
    expect(screen.getByText("相手の準備待ち")).toBeTruthy();
    expect(screen.getByText("返事待ち")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2人の相性シートを見る" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を行う" }).getAttribute("href")).toBe(
      "/diagnosis?category=friend",
    );
    expect(screen.getByRole("link", { name: "わたしのまとめを作る" }).getAttribute("href")).toBe(
      "/me?shareCategory=work",
    );
    expect(
      screen
        .getByRole("heading", { name: "ふゆさん" })
        .closest("article")
        ?.querySelector("a")
        ?.getAttribute("href"),
    ).toBe(`/compatibility/relationships/${"5".repeat(64)}`);
    expect(screen.getAllByRole("link", { name: "共有の確認・終了" })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "相性" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "LINEでもう一度送る" }));
    expect(onResend).toHaveBeenCalledWith(pending);
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    expect(onCancel).toHaveBeenCalledWith(pending.relationshipId);
  });

  it("相性一覧に自分自身を含む共通の絞り込みを表示する", () => {
    const onCategoryFilterChange = vi.fn();
    render(
      <CompatibilityListScreen
        categoryFilter="family"
        state={{
          status: "success",
          data: {
            items: [
              {
                relationshipId: "1".repeat(64),
                relationshipCategory: "family",
                status: "accepted",
                partnerDisplayName: "家族の相手",
                readiness: { status: "ready", comparableThemeCount: 2 },
              },
              {
                relationshipId: "2".repeat(64),
                relationshipCategory: "friend",
                status: "pending",
                expiresAt: "2026-08-26T00:00:00.000Z",
                invitationUrl: "https://example.com/friend",
              },
            ],
          },
        }}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onCategoryFilterChange={onCategoryFilterChange}
        onResend={vi.fn()}
      />,
    );

    const filters = screen.getByRole("group", { name: "関係カテゴリで絞り込む" });
    expect(Array.from(filters.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "全部",
      "パートナー",
      "家族",
      "友達",
      "仕事",
      "自分自身",
    ]);
    expect(screen.getByRole("button", { name: "家族" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "家族の相手さん" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "返事待ち" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "友達" }));
    expect(onCategoryFilterChange).toHaveBeenCalledWith("friend");

    fireEvent.click(screen.getByRole("button", { name: "自分自身" }));
    expect(onCategoryFilterChange).toHaveBeenCalledWith("general");
  });

  it("選択カテゴリに対象がなくても一覧全体の空状態と区別する", () => {
    render(
      <CompatibilityListScreen
        categoryFilter="work"
        state={{
          status: "success",
          data: {
            items: [
              {
                relationshipId: "1".repeat(64),
                relationshipCategory: "partner",
                status: "pending",
                expiresAt: "2026-08-26T00:00:00.000Z",
                invitationUrl: "https://example.com/partner",
              },
            ],
          },
        }}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "このカテゴリの相手・招待はありません" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "まだ共有中の相手はいません" })).toBeNull();
  });

  it("招待の取消中は一覧をSkeletonに戻さず対象カードだけにSpinnerを表示する", () => {
    const cancellingId = "1".repeat(64);
    render(
      <CompatibilityListScreen
        state={{
          status: "success",
          data: {
            items: [
              {
                relationshipId: cancellingId,
                relationshipCategory: "friend",
                status: "pending",
                expiresAt: "2026-08-26T00:00:00.000Z",
                invitationUrl: "https://example.com/first",
              },
              {
                relationshipId: "2".repeat(64),
                relationshipCategory: "work",
                status: "pending",
                expiresAt: "2026-08-27T00:00:00.000Z",
                invitationUrl: "https://example.com/second",
              },
            ],
          },
        }}
        operation={{ status: "loading" }}
        cancellingRelationshipId={cancellingId}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("相性一覧を読み込み中")).toBeNull();
    const spinner = screen.getByLabelText("招待を取り消しています");
    expect(spinner.closest("article")?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll('article[aria-busy="true"]')).toHaveLength(1);
  });

  it("共有画面では具体的な内容を出さず、共有の範囲と自動共有だけを伝える", () => {
    const consent: CompatibilityShareConsent = {
      displayName: "うさぎ",
      avatarUrl: "https://profile.line-scdn.net/me",
      canShare: true,
      blockingReasons: [],
      nextAction: null,
    };
    const onIssue = vi.fn();
    render(
      <CompatibilityShareScreen
        state={{ status: "success", data: consent }}
        relationshipCategory="partner"
        onIssue={onIssue}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("うさぎさんから招待")).toBeTruthy();
    expect(screen.getByText("必要なら変更できます")).toBeTruthy();
    expect(document.querySelector('img[src="https://profile.line-scdn.net/me"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "共有されるもの" })).toBeTruthy();
    expect(screen.getByText(/これから増える分も自動で/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "「わたし」" }).getAttribute("href")).toBe(
      "/me?shareCategory=partner",
    );
    expect(screen.queryByText(/傾向があります/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "まず知ってほしいこと" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "共有されない詳細" })).toBeTruthy();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
    const issueButton = screen.getByRole("button", { name: "共有して招待リンクを発行する" });
    expect(issueButton.closest("footer")?.classList.contains("fixed")).toBe(true);
    expect(issueButton.classList.contains("h-12")).toBe(true);
    expect(issueButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(issueButton);
    expect(onIssue).toHaveBeenCalledOnce();
  });

  it("共有内容の確認は選択カテゴリを保ったままアプリ内でわたしへ移動する", () => {
    window.history.replaceState({}, "", "/compatibility/share?category=family");
    const handlePopState = vi.fn();
    window.addEventListener("popstate", handlePopState);
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "わたし",
            avatarUrl: null,
            canShare: true,
            blockingReasons: [],
            nextAction: null,
          },
        }}
        relationshipCategory="family"
        onRetry={vi.fn()}
      />,
    );

    expect(fireEvent.click(screen.getByRole("link", { name: "「わたし」" }))).toBe(false);
    expect(window.location.pathname + window.location.search).toBe("/me?shareCategory=family");
    expect(handlePopState).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", handlePopState);
  });

  it("共有画面の固定内容は初回取得を待たずに表示する", () => {
    render(<CompatibilityShareScreen state={{ status: "loading" }} onRetry={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "うつしをシェア" })).toBeTruthy();
    expect(screen.getByText("必要なら変更できます")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有されるもの" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有されない詳細" })).toBeTruthy();
    expect(screen.getByLabelText("共有者の情報を読み込み中")).toBeTruthy();
    expect(screen.queryByLabelText("共有の確認を読み込み中")).toBeNull();
    expect(
      screen.getByRole("radio", { name: "家族" }).closest("fieldset")?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "共有して招待リンクを発行する" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("共有カテゴリはパートナーを初期選択し、選択マークと枠をカテゴリ色に揃える", () => {
    const state = {
      status: "success" as const,
      data: {
        displayName: "うさぎ",
        avatarUrl: null,
        canShare: true,
        blockingReasons: [],
        nextAction: null,
      },
    };
    const onRetry = vi.fn();
    const { rerender } = render(<CompatibilityShareScreen state={state} onRetry={onRetry} />);

    expect((screen.getByRole("radio", { name: "パートナー" }) as HTMLInputElement).checked).toBe(
      true,
    );

    const categoryColors = [
      ["partner", "パートナー", "bg-rose-500", "focus-within:ring-rose-500", "border-rose-500"],
      ["family", "家族", "bg-amber-500", "focus-within:ring-amber-500", "border-amber-500"],
      ["friend", "友達", "bg-emerald-500", "focus-within:ring-emerald-500", "border-emerald-500"],
      ["work", "仕事", "bg-blue-500", "focus-within:ring-blue-500", "border-blue-500"],
    ] as const;
    for (const [
      category,
      label,
      accentClassName,
      focusClassName,
      borderClassName,
    ] of categoryColors) {
      rerender(
        <CompatibilityShareScreen
          state={state}
          relationshipCategory={category}
          onRetry={onRetry}
        />,
      );
      const radio = screen.getByRole("radio", { name: label }) as HTMLInputElement;
      const categoryLabel = radio.closest("label");
      expect(radio.checked).toBe(true);
      expect(radio.classList.contains("appearance-none")).toBe(true);
      expect(radio.classList.contains("border-white")).toBe(true);
      expect(radio.classList.contains(accentClassName)).toBe(true);
      expect(categoryLabel?.classList.contains(focusClassName)).toBe(true);
      expect(categoryLabel?.classList.contains(borderClassName)).toBe(true);
    }

    expect(
      screen.getByRole("button", { name: "共有して招待リンクを発行する" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("関係カテゴリを選ぶまで招待リンクを発行できない", () => {
    const onRelationshipCategoryChange = vi.fn();
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "うさぎ",
            avatarUrl: null,
            canShare: true,
            blockingReasons: [],
            nextAction: null,
          },
        }}
        relationshipCategory={null}
        onIssue={vi.fn()}
        onRelationshipCategoryChange={onRelationshipCategoryChange}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "共有して招待リンクを発行する" }).hasAttribute("disabled"),
    ).toBe(true);
    const familyRadio = screen.getByRole("radio", { name: "家族" });
    expect(familyRadio.classList.contains("sr-only")).toBe(false);
    fireEvent.click(familyRadio);
    expect(onRelationshipCategoryChange).toHaveBeenCalledWith("family");
  });

  it("発行後に固定フッターから友だちへの送信とコピーを選べる", () => {
    const invitationUrl = `https://example.com/compatibility/invitations/${"1".repeat(64)}`;
    const onShareToLine = vi.fn();
    const onCopyLink = vi.fn();
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "うさぎ",
            avatarUrl: null,
            canShare: true,
            blockingReasons: [],
            nextAction: null,
          },
        }}
        invitationState={{
          status: "success",
          data: {
            invitationUrl,
            expiresAt: "2026-08-26T00:00:00.000Z",
            relationshipCategory: "partner",
          },
        }}
        onCopyLink={onCopyLink}
        onRetry={vi.fn()}
        relationshipCategory="partner"
        onShareToLine={onShareToLine}
      />,
    );

    const sendButton = screen.getByRole("button", { name: "友だちに送る" });
    const copyButton = screen.getByRole("button", { name: "コピー" });
    const successCard = screen
      .getByRole("heading", { name: "招待リンクを発行しました" })
      .closest("section");
    const privacyCard = screen
      .getByRole("heading", { name: "共有されない詳細" })
      .closest("section");
    const footer = sendButton.closest("footer");
    expect(document.querySelector("details")).toBeNull();
    expect(successCard).toBe(privacyCard);
    expect(privacyCard?.classList.contains("border")).toBe(true);
    expect(footer?.classList.contains("fixed")).toBe(true);
    expect(copyButton.closest("footer")).toBe(footer);
    expect(sendButton.parentElement?.classList.contains("grid-cols-2")).toBe(true);
    expect(sendButton.parentElement?.classList.contains("h-12")).toBe(true);
    expect(screen.getByRole("heading", { name: "招待リンクを発行しました" })).toBeTruthy();
    fireEvent.click(sendButton);
    fireEvent.click(copyButton);
    expect(onShareToLine).toHaveBeenCalledWith(invitationUrl);
    expect(onCopyLink).toHaveBeenCalledWith(invitationUrl);
  });

  it("共有できる内容がまだなくても発行でき、診断への導線だけを添える", () => {
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "うさぎ",
            avatarUrl: null,
            canShare: true,
            blockingReasons: [],
            nextAction: "diagnosis",
          },
        }}
        onRetry={vi.fn()}
        relationshipCategory="partner"
      />,
    );

    expect(screen.getByText(/2人で比べられるテーマが増えます/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を始める" }).getAttribute("href")).toBe(
      "/diagnosis?category=partner",
    );
    expect(
      screen.getByRole("button", { name: "共有して招待リンクを発行する" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("共有画面からわたしのまとめへ選択中のカテゴリを引き継ぐ", () => {
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "うさぎ",
            avatarUrl: null,
            canShare: true,
            blockingReasons: [],
            nextAction: "profile-summary",
          },
        }}
        onRetry={vi.fn()}
        relationshipCategory="family"
      />,
    );

    expect(screen.getByRole("link", { name: "わたしの傾向を作る" }).getAttribute("href")).toBe(
      "/me?shareCategory=family",
    );
  });

  it("表示名を確認できない場合は招待リンクを発行できない", () => {
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: null,
            avatarUrl: null,
            canShare: false,
            blockingReasons: ["display_name_unavailable"],
            nextAction: null,
          },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/LINEの表示名を確認できませんでした。/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "招待リンクを発行できません" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("受信者は共有していいかだけを確認して承諾できる", () => {
    const invitation: CompatibilityInvitationPreview = {
      relationshipCategory: "family",
      inviter: { displayName: "あおい", avatarUrl: "https://profile.line-scdn.net/inviter" },
      recipient: { displayName: "はる", avatarUrl: null },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: "diagnosis",
    };
    const onAccept = vi.fn();
    render(
      <CompatibilityInvitationScreen
        state={{ status: "success", data: invitation }}
        onAccept={onAccept}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(
      document.querySelector('img[src="https://profile.line-scdn.net/inviter"]'),
    ).not.toBeNull();
    expect(screen.getByText("は")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有されるもの" })).toBeTruthy();
    expect(screen.queryByText(/傾向があります/)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を見る" }).getAttribute("href")).toBe(
      "/diagnosis?category=family",
    );
    expect(screen.getByRole("button", { name: "相性を見てみる" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "相性を見てみる" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("招待の確認からわたしのまとめへ関係カテゴリを引き継ぐ", () => {
    render(
      <CompatibilityInvitationScreen
        state={{
          status: "success",
          data: {
            relationshipCategory: "friend",
            inviter: { displayName: "あおい", avatarUrl: null },
            recipient: { displayName: "はる", avatarUrl: null },
            expiresAt: "2026-08-26T00:00:00.000Z",
            canAccept: true,
            blockingReasons: [],
            nextAction: "profile-summary",
          },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "わたしの傾向を作る" }).getAttribute("href")).toBe(
      "/me?shareCategory=friend",
    );
  });

  it("人物ごとの資料と2人の共通点・違いをタブとスワイプで切り替える", () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <CompatibilityResultScreen
        me={me}
        partner={aoi}
        relationshipCategory="partner"
        onEnd={onEnd}
      />,
    );

    expect(screen.getByRole("heading", { name: "2人の相性シート" })).toBeTruthy();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["あおいさんについて", "わたしについて"]);

    expect(screen.getByRole("tab", { name: "それぞれについて" })).toBeTruthy();
    const peoplePanel = screen.getByRole("tabpanel");
    firePointer(peoplePanel, "pointerdown", {
      button: 0,
      clientX: 180,
      clientY: 100,
      pointerId: 1,
    });
    firePointer(peoplePanel, "pointermove", {
      clientX: 130,
      clientY: 104,
      pointerId: 1,
    });
    expect(screen.getByTestId("compatibility-section-track").style.transform).toContain("-50px");
    firePointer(peoplePanel, "pointerup", {
      clientX: 100,
      clientY: 108,
      pointerId: 1,
    });
    expect(screen.getByRole("heading", { name: "一緒に大切にできそうなこと" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "話してみたい違い" })).toBeTruthy();
    expect(screen.getByTestId("compatibility-tab-indicator").style.transform).toBe(
      "translate3d(100%, 0, 0)",
    );

    const pairPanel = screen.getByRole("tabpanel");
    firePointer(pairPanel, "pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 2,
    });
    firePointer(pairPanel, "pointerup", {
      clientX: 180,
      clientY: 108,
      pointerId: 2,
    });
    expect(screen.getByRole("heading", { name: "あおいさんについて" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "2人について" }));
    expect(screen.getByRole("link", { name: "診断を見てみる" }).getAttribute("href")).toBe(
      "/diagnosis?category=partner",
    );

    fireEvent.click(screen.getByRole("button", { name: "共有を終了する" }));
    expect(
      screen.getByText("終了すると、2人ともこの相性シートを見られなくなります。"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "共有を終了" }));
    expect(onEnd).toHaveBeenCalledOnce();
    rerender(
      <CompatibilityResultScreen
        me={me}
        partner={aoi}
        relationshipCategory="partner"
        onEnd={onEnd}
        endingState={{ status: "loading" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "終了しています..." }).querySelector("svg"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "戻る" }).hasAttribute("disabled")).toBe(true);
    rerender(
      <CompatibilityResultScreen
        me={me}
        partner={aoi}
        relationshipCategory="partner"
        onEnd={onEnd}
        endingState={{ status: "success", data: null }}
      />,
    );
    expect(screen.getByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" })).toBeTruthy();
  });
});
