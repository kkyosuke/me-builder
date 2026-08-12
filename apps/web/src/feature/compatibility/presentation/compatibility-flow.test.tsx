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
  afterEach(cleanup);

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
    expect(loader.querySelector("div[aria-hidden='true'] > .space-y-3")).toBeTruthy();
  });

  it("APIの一覧で共有中と返事待ちを区別し、再送と取消を操作できる", () => {
    const onCancel = vi.fn();
    const onResend = vi.fn();
    const pending = {
      relationshipId: "1".repeat(64),
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
                status: "accepted",
                partnerDisplayName: "あおい",
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
    expect(screen.getByText("共有中")).toBeTruthy();
    expect(screen.getByText("返事待ち")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2人の相性シートを見る" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "LINEでもう一度送る" }));
    expect(onResend).toHaveBeenCalledWith(pending);
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    expect(onCancel).toHaveBeenCalledWith(pending.relationshipId);
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
                status: "pending",
                expiresAt: "2026-08-26T00:00:00.000Z",
                invitationUrl: "https://example.com/first",
              },
              {
                relationshipId: "2".repeat(64),
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
        onIssue={onIssue}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("うさぎさんから招待")).toBeTruthy();
    expect(document.querySelector('img[src="https://profile.line-scdn.net/me"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "共有されるもの" })).toBeTruthy();
    expect(screen.getByText(/これから増える分も自動で/)).toBeTruthy();
    expect(screen.queryByText(/傾向があります/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "まず知ってほしいこと" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const disclosure = screen.getByText("共有されない詳細").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    const issueButton = screen.getByRole("button", { name: "共有して招待リンクを発行する" });
    expect(issueButton.closest("footer")?.classList.contains("fixed")).toBe(true);
    expect(issueButton.classList.contains("h-12")).toBe(true);
    expect(issueButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByText("共有されない詳細"));
    expect(disclosure?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
    fireEvent.click(issueButton);
    expect(onIssue).toHaveBeenCalledOnce();
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
          data: { invitationUrl, expiresAt: "2026-08-26T00:00:00.000Z" },
        }}
        onCopyLink={onCopyLink}
        onRetry={vi.fn()}
        onShareToLine={onShareToLine}
      />,
    );

    const sendButton = screen.getByRole("button", { name: "友だちに送る" });
    const copyButton = screen.getByRole("button", { name: "コピー" });
    const footer = sendButton.closest("footer");
    expect(footer?.classList.contains("fixed")).toBe(true);
    expect(copyButton.closest("footer")).toBe(footer);
    expect(sendButton.parentElement?.classList.contains("grid-cols-2")).toBe(true);
    expect(sendButton.parentElement?.classList.contains("h-12")).toBe(true);
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
      />,
    );

    expect(screen.getByText(/2人で比べられるテーマが増えます/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を始める" }).getAttribute("href")).toBe(
      "/diagnosis",
    );
    expect(
      screen.getByRole("button", { name: "共有して招待リンクを発行する" }).hasAttribute("disabled"),
    ).toBe(false);
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
      inviter: { displayName: "あおい", avatarUrl: "https://profile.line-scdn.net/inviter" },
      recipient: { displayName: "はる", avatarUrl: null },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: null,
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
    expect(screen.getByRole("button", { name: "相性を見てみる" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "相性を見てみる" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("人物ごとの資料と2人の共通点・違いをタブとスワイプで切り替える", () => {
    const onEnd = vi.fn();
    const { rerender } = render(<CompatibilityResultScreen me={me} partner={aoi} onEnd={onEnd} />);

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
        onEnd={onEnd}
        endingState={{ status: "success", data: null }}
      />,
    );
    expect(screen.getByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" })).toBeTruthy();
  });
});
