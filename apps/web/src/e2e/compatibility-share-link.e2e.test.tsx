// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompatibilityInvitationPreview } from "../feature/compatibility/model/compatibility-invitation-preview";
import type { CompatibilityRelationship } from "../feature/compatibility/model/compatibility-relationship";
import { resolveCompatibilityInvitationId } from "../feature/compatibility/model/compatibility-route";
import CompatibilityApplication from "../feature/compatibility/presentation/compatibility-application";
import CompatibilityInvitationApplication from "../feature/compatibility/presentation/compatibility-invitation-application";

const mocks = vi.hoisted(() => ({
  acquireIdToken: vi.fn().mockResolvedValue("recipient-token"),
  fetchCompatibilityAvatarImage: vi.fn(),
  fetchCompatibilityInvitation: vi.fn(),
  fetchCompatibilityShareConsent: vi.fn(),
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
  fetchCompatibilityShareConsent: mocks.fetchCompatibilityShareConsent,
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
vi.mock("../feature/compatibility/infrastructure/compatibility-avatar-api", () => ({
  fetchCompatibilityAvatarImage: mocks.fetchCompatibilityAvatarImage,
}));

vi.mock("../feature/liff", () => ({
  useLiffSession: () => ({ acquireIdToken: mocks.acquireIdToken }),
}));

describe("LIFF compatibility share link journey", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("共有リンク発行からLINE送信・承諾・相性表示・共有終了までUIで完了する", async () => {
    const relationshipId = "2".repeat(64);
    const invitationUrl = `https://liff.line.me/1234567890-testliff/compatibility/invitations/${relationshipId}`;
    const profile = {
      profileSummaryVersionId: "profile-1",
      generatedAt: "2026-08-12T00:00:00.000Z",
      statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
    };
    const inviterParameter = {
      id: "planning",
      label: "予定の立て方",
      lowLabel: "その場で決めたい",
      highLabel: "早めに決めたい",
      position: 78,
      statement: "私は早めに予定を決めたいです",
      request: "予定は早めに相談してもらえるとうれしいです",
      band: "high" as const,
    };
    const inviterTheme = {
      diagnosisId: "time-planning",
      title: "時間と予定",
      parameters: [inviterParameter],
    };
    const recipientTheme = {
      ...inviterTheme,
      parameters: [
        {
          ...inviterParameter,
          position: 30,
          statement: "私は余白を残したいです",
          request: "急がず相談してもらえるとうれしいです",
          band: "low" as const,
        },
      ],
    };

    mocks.fetchCompatibilityShareConsent.mockResolvedValue({
      displayName: "あおい",
      avatarUrl: "/api/profile/avatar",
      canShare: true,
      blockingReasons: [],
      nextAction: null,
    });
    mocks.issueCompatibilityInvitation.mockResolvedValue({
      invitationUrl,
      expiresAt: "2026-08-26T00:00:00.000Z",
      relationshipCategory: "partner",
    });
    mocks.shareCompatibilityInvitationToLine.mockResolvedValue("line");
    mocks.fetchCompatibilityInvitation.mockResolvedValue({
      relationshipCategory: "partner",
      inviter: {
        displayName: "あおい",
        avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
      },
      recipient: { displayName: "はる", avatarUrl: "/api/profile/avatar" },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: null,
    });
    mocks.acceptCompatibilityInvitation.mockResolvedValue({ relationshipId, status: "accepted" });
    const relationship = {
      relationshipId,
      status: "ready",
      relationshipCategory: "partner",
      partner: { displayName: "あおい", aboutMe: profile, themes: [inviterTheme] },
      viewer: { displayName: "はる", aboutMe: profile, themes: [recipientTheme] },
      unavailableThemes: [{ diagnosisId: "money-values", title: "お金と消費" }],
    } satisfies CompatibilityRelationship;
    mocks.fetchCompatibilityRelationship.mockResolvedValue(relationship);
    mocks.endCompatibilityRelationship.mockResolvedValue(undefined);
    mocks.fetchCompatibilityRelationships.mockResolvedValue({ items: [] });

    window.history.replaceState({}, "", "/compatibility/share");
    render(<CompatibilityApplication />);

    fireEvent.click(await screen.findByRole("radio", { name: "パートナー" }));
    const issueButton = await screen.findByRole("button", {
      name: "共有して招待リンクを発行する",
    });
    await waitFor(() => expect(issueButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(issueButton);
    await waitFor(() =>
      expect(mocks.issueCompatibilityInvitation).toHaveBeenCalledWith(
        undefined,
        "recipient-token",
        "partner",
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "友だちに送る" }));
    expect(mocks.shareCompatibilityInvitationToLine).toHaveBeenCalledWith(
      "あおい",
      "partner",
      invitationUrl,
    );

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
    expect(screen.getAllByText("共有プロフィール生成日時")).toHaveLength(2);
    expect(screen.getAllByText(/2026年8月12日/)).toHaveLength(2);
    expect(screen.getByText("予定は早めに相談してもらえるとうれしいです")).toBeTruthy();
    expect(screen.getByText("急がず相談してもらえるとうれしいです")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "2人について" }));
    expect(screen.getByText(/異なる傾向が見えています/)).toBeTruthy();
    expect(screen.getByText("「お金と消費」は、現在は2人分を比較できません。")).toBeTruthy();
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

  it("発行されたLIFFリンクのpathから受信者へ共有の確認を表示する", async () => {
    const relationshipId = "1".repeat(64);
    const liffId = "1234567890-testliff";
    const invitationUrl = new URL(
      `https://liff.line.me/${liffId}/compatibility/invitations/${relationshipId}`,
    );
    const liffState = invitationUrl.pathname.slice(`/${liffId}`.length);
    const invitation = {
      relationshipCategory: "partner",
      inviter: {
        displayName: "あおい",
        avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
      },
      recipient: { displayName: "はる", avatarUrl: null },
      expiresAt: "2026-08-26T00:00:00.000Z",
      canAccept: true,
      blockingReasons: [],
      nextAction: "diagnosis",
    } satisfies CompatibilityInvitationPreview;
    mocks.fetchCompatibilityInvitation.mockResolvedValue(invitation);
    mocks.fetchCompatibilityAvatarImage
      .mockResolvedValueOnce(new Blob([Uint8Array.from([1])]))
      .mockResolvedValueOnce(null);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:inviter-avatar");
    URL.revokeObjectURL = vi.fn();

    render(
      <CompatibilityInvitationApplication
        relationshipId={resolveCompatibilityInvitationId(liffState)}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "2人の相性を見てみませんか？" }),
    ).toBeTruthy();
    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(document.querySelector('img[src="blob:inviter-avatar"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "共有されるもの" })).toBeTruthy();
    expect(screen.queryByText(/傾向があります/)).toBeNull();
    expect(mocks.fetchCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      "recipient-token",
      relationshipId,
      expect.any(AbortSignal),
    );
  });
});
