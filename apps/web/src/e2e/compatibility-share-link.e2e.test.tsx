// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCompatibilityInvitationId } from "../feature/compatibility/model/compatibility-route";
import CompatibilityApplication from "../feature/compatibility/presentation/compatibility-application";
import CompatibilityInvitationApplication from "../feature/compatibility/presentation/compatibility-invitation-application";

const mocks = vi.hoisted(() => ({
  acquireIdToken: vi.fn().mockResolvedValue("recipient-token"),
  fetchCompatibilityInvitation: vi.fn(),
  fetchCompatibilitySharePreview: vi.fn(),
  issueCompatibilityInvitation: vi.fn(),
  acceptCompatibilityInvitation: vi.fn(),
  fetchCompatibilityRelationships: vi.fn(),
  fetchCompatibilityRelationship: vi.fn(),
  cancelCompatibilityInvitation: vi.fn(),
  endCompatibilityRelationship: vi.fn(),
  shareCompatibilityInvitationToLine: vi.fn(),
}));

vi.mock("../feature/compatibility/infrastructure/compatibility-api", () => ({
  fetchCompatibilityInvitation: mocks.fetchCompatibilityInvitation,
  fetchCompatibilitySharePreview: mocks.fetchCompatibilitySharePreview,
  issueCompatibilityInvitation: mocks.issueCompatibilityInvitation,
  acceptCompatibilityInvitation: mocks.acceptCompatibilityInvitation,
  fetchCompatibilityRelationships: mocks.fetchCompatibilityRelationships,
  fetchCompatibilityRelationship: mocks.fetchCompatibilityRelationship,
  cancelCompatibilityInvitation: mocks.cancelCompatibilityInvitation,
  endCompatibilityRelationship: mocks.endCompatibilityRelationship,
}));

vi.mock("../feature/compatibility/infrastructure/compatibility-invitation-sharing", () => ({
  shareCompatibilityInvitationToLine: mocks.shareCompatibilityInvitationToLine,
  copyCompatibilityInvitationUrl: vi.fn(),
}));

vi.mock("../feature/liff", () => ({
  useLiffSession: () => ({ acquireIdToken: mocks.acquireIdToken }),
}));

describe("LIFF compatibility share link journey", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("共有リンク発行からLINE送信・承諾・相性表示・共有終了までUIで完了する", async () => {
    const relationshipId = "2".repeat(64);
    const previewToken = `csp2.${"b".repeat(64)}`;
    const invitationUrl = `https://liff.line.me/1234567890-testliff/compatibility/invitations/${relationshipId}`;
    const profile = {
      profileSummaryVersionId: "profile-1",
      generatedAt: "2026-08-12T00:00:00.000Z",
      statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
    };
    const inviterTheme = {
      diagnosisId: "time-planning",
      title: "時間と予定",
      parameters: [
        {
          id: "planning",
          label: "予定の立て方",
          lowLabel: "その場で決めたい",
          highLabel: "早めに決めたい",
          position: 78,
          statement: "私は早めに予定を決めたいです",
        },
      ],
    };
    const recipientTheme = {
      ...inviterTheme,
      parameters: [
        { ...inviterTheme.parameters[0], position: 30, statement: "私は余白を残したいです" },
      ],
    };

    mocks.fetchCompatibilitySharePreview.mockResolvedValue({
      displayName: "あおい",
      previewToken,
      aboutMe: profile,
      themes: [inviterTheme],
      canIssueInvitation: true,
      blockingReasons: [],
      nextAction: null,
    });
    mocks.issueCompatibilityInvitation.mockResolvedValue({
      invitationUrl,
      expiresAt: "2026-08-26T00:00:00.000Z",
    });
    mocks.shareCompatibilityInvitationToLine.mockResolvedValue("line");
    mocks.fetchCompatibilityInvitation.mockResolvedValue({
      inviter: { displayName: "あおい", aboutMe: profile, themes: [inviterTheme] },
      recipient: { displayName: "はる", previewToken, aboutMe: profile, themes: [recipientTheme] },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: null,
    });
    mocks.acceptCompatibilityInvitation.mockResolvedValue({ relationshipId, status: "accepted" });
    mocks.fetchCompatibilityRelationship.mockResolvedValue({
      relationshipId,
      status: "ready",
      partner: { displayName: "あおい", aboutMe: profile, themes: [inviterTheme] },
      viewer: { displayName: "はる", aboutMe: profile, themes: [recipientTheme] },
    });
    mocks.endCompatibilityRelationship.mockResolvedValue(undefined);
    mocks.fetchCompatibilityRelationships.mockResolvedValue({ items: [] });

    window.history.replaceState({}, "", "/compatibility/share");
    render(<CompatibilityApplication />);

    fireEvent.click(await screen.findByRole("button", { name: "招待リンクを発行する" }));
    fireEvent.click(await screen.findByRole("button", { name: "LINEで送る" }));
    expect(mocks.shareCompatibilityInvitationToLine).toHaveBeenCalledWith("あおい", invitationUrl);

    await act(async () => {
      window.history.pushState({}, "", `/compatibility/invitations/${relationshipId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    fireEvent.click(await screen.findByRole("button", { name: "相性を見てみる" }));
    expect(
      await screen.findByRole("heading", { name: "2人の相性シートを作りました" }),
    ).toBeTruthy();

    await act(async () => {
      window.history.pushState({}, "", `/compatibility/relationships/${relationshipId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("heading", { name: "2人の相性シート" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "あおいさんについて" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "共有を終了する" }));
    fireEvent.click(screen.getByRole("button", { name: "共有を終了" }));
    expect(await screen.findByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(mocks.endCompatibilityRelationship).toHaveBeenCalledWith(
      undefined,
      "recipient-token",
      relationshipId,
      expect.any(AbortSignal),
    );

    await act(async () => {
      window.history.pushState({}, "", "/compatibility");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("まだ共有中の相手はいません")).toBeTruthy();
  });

  it("発行されたLIFFリンクのpathから受信者へ双方の共有内容を表示する", async () => {
    const relationshipId = "1".repeat(64);
    const liffId = "1234567890-testliff";
    const invitationUrl = new URL(
      `https://liff.line.me/${liffId}/compatibility/invitations/${relationshipId}`,
    );
    const liffState = invitationUrl.pathname.slice(`/${liffId}`.length);
    mocks.fetchCompatibilityInvitation.mockResolvedValue({
      inviter: {
        displayName: "あおい",
        avatarUrl: "https://profile.line-scdn.net/inviter",
        aboutMe: {
          profileSummaryVersionId: "profile-inviter",
          generatedAt: "2026-08-11T00:00:00.000Z",
          statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
        },
        themes: [
          {
            diagnosisId: "time-planning",
            title: "時間と予定",
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
          },
        ],
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
        themes: [],
      },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: false,
      blockingReasons: ["common_diagnosis_required"],
      nextAction: "diagnosis",
    });

    render(
      <CompatibilityInvitationApplication
        relationshipId={resolveCompatibilityInvitationId(liffState)}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "2人の相性を見てみませんか？" }),
    ).toBeTruthy();
    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(
      document.querySelector('img[src="https://profile.line-scdn.net/inviter"]'),
    ).not.toBeNull();
    expect(screen.getByText("私は見通しを大切にします")).toBeTruthy();
    expect(mocks.fetchCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      "recipient-token",
      relationshipId,
      expect.any(AbortSignal),
    );
  });
});
