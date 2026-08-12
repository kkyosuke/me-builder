// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aoi, me } from "../infrastructure/compatibility-demo";
import type { CompatibilityInvitationPreview } from "../model/compatibility-invitation-preview";
import type { CompatibilitySharePreview } from "../model/compatibility-share-preview";
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

  it("APIから取得した振る舞い・考え方をすべて表示し、詳細は共有しない", () => {
    const preview: CompatibilitySharePreview = {
      displayName: "うさぎ",
      avatarUrl: "https://profile.line-scdn.net/me",
      previewToken: `csp2.${"a".repeat(64)}`,
      aboutMe: {
        profileSummaryVersionId: "summary-version-1",
        generatedAt: "2026-08-11T00:00:00.000Z",
        statements: [
          {
            key: "planning-style",
            label: "予定の立て方",
            statement: "私は、先の見通しを持って動けると安心しやすいです",
          },
        ],
      },
      themes: [
        {
          diagnosisId: "daily-life",
          title: "暮らし方",
          parameters: [
            {
              id: "planning",
              label: "予定の立て方",
              lowLabel: "その場で決めたい",
              highLabel: "早めに決めたい",
              position: 78,
              statement: "「早めに決めたい」傾向があります",
            },
            {
              id: "holiday",
              label: "休日の過ごし方",
              lowLabel: "ひとり時間を重視",
              highLabel: "一緒の時間を重視",
              position: 68,
              statement: "「一緒の時間を重視」傾向があります",
            },
          ],
        },
      ],
      canIssueInvitation: true,
      blockingReasons: [],
      nextAction: null,
    };
    const onIssue = vi.fn();
    render(
      <CompatibilityShareScreen
        state={{ status: "success", data: preview }}
        onIssue={onIssue}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("うさぎさんから招待")).toBeTruthy();
    expect(document.querySelector('img[src="https://profile.line-scdn.net/me"]')).not.toBeNull();
    expect(screen.getByText("私は、先の見通しを持って動けると安心しやすいです")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "暮らし方" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有する振る舞い・考え方" })).toBeTruthy();
    expect(screen.getByText("2件すべて共有")).toBeTruthy();
    expect(screen.getByText("「早めに決めたい」傾向があります")).toBeTruthy();
    expect(screen.queryByText("「「早めに決めたい」傾向があります」")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const disclosure = screen.getByText("共有されない詳細").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    const issueButton = screen.getByRole("button", { name: "招待リンクを発行する" });
    expect(issueButton.closest("footer")?.classList.contains("fixed")).toBe(true);
    expect(issueButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByText("共有されない詳細"));
    expect(disclosure?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
    fireEvent.click(issueButton);
    expect(onIssue).toHaveBeenCalledWith(preview.previewToken);
  });

  it("発行後にLINE共有とリンクコピーを選べる", () => {
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
            previewToken: `csp2.${"a".repeat(64)}`,
            aboutMe: null,
            themes: [],
            canIssueInvitation: true,
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

    fireEvent.click(screen.getByRole("button", { name: "LINEで送る" }));
    fireEvent.click(screen.getByRole("button", { name: "リンクをコピー" }));
    expect(onShareToLine).toHaveBeenCalledWith(invitationUrl);
    expect(onCopyLink).toHaveBeenCalledWith(invitationUrl);
  });

  it("共有できる診断がなければ診断への導線を表示する", () => {
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "うさぎ",
            avatarUrl: null,
            previewToken: `csp2.${"b".repeat(64)}`,
            aboutMe: {
              profileSummaryVersionId: "summary-version-1",
              generatedAt: "2026-08-11T00:00:00.000Z",
              statements: [
                {
                  key: "planning-style",
                  label: "予定の立て方",
                  statement: "私は、先の見通しを持つことを大切にしています",
                },
              ],
            },
            themes: [],
            canIssueInvitation: false,
            blockingReasons: ["diagnosis_required"],
            nextAction: "diagnosis",
          },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/共有できる診断結果がまだありません。/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を始める" }).getAttribute("href")).toBe(
      "/diagnosis",
    );
    expect(
      screen.getByRole("button", { name: "招待リンクを発行できません" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("受信者が双方の実際の共有内容を確認して承諾できる", () => {
    const theme = {
      diagnosisId: "daily-life",
      title: "暮らし方",
      parameters: [
        {
          id: "planning",
          label: "予定の立て方",
          lowLabel: "その場で決めたい",
          highLabel: "早めに決めたい",
          position: 78,
          statement: "「早めに決めたい」傾向があります",
        },
      ],
    };
    const invitation: CompatibilityInvitationPreview = {
      inviter: {
        displayName: "あおい",
        avatarUrl: "https://profile.line-scdn.net/inviter",
        aboutMe: {
          profileSummaryVersionId: "profile-inviter",
          generatedAt: "2026-08-11T00:00:00.000Z",
          statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
        },
        themes: [theme],
      },
      recipient: {
        displayName: "はる",
        avatarUrl: null,
        previewToken: `csp2.${"a".repeat(64)}`,
        aboutMe: {
          profileSummaryVersionId: "profile-recipient",
          generatedAt: "2026-08-12T00:00:00.000Z",
          statements: [{ key: "space", label: "余白", statement: "私は予定の余白を大切にします" }],
        },
        themes: [theme],
      },
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
    expect(screen.getByText("私は見通しを大切にします")).toBeTruthy();
    expect(screen.getByText("私は予定の余白を大切にします")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "共有する振る舞い・考え方" })).toHaveLength(2);
    expect(screen.getByText("1テーマが共通")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "相性を見てみる" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "相性を見てみる" }));
    expect(onAccept).toHaveBeenCalledWith(invitation.recipient.previewToken);
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
        endingState={{ status: "success", data: null }}
      />,
    );
    expect(screen.getByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" })).toBeTruthy();
  });
});
