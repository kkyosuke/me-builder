// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCompatibilityInvitationId } from "../feature/compatibility/model/compatibility-route";
import CompatibilityInvitationApplication from "../feature/compatibility/presentation/compatibility-invitation-application";

const mocks = vi.hoisted(() => ({
  acquireIdToken: vi.fn().mockResolvedValue("recipient-token"),
  fetchCompatibilityInvitation: vi.fn(),
}));

vi.mock("../feature/compatibility/infrastructure/compatibility-api", () => ({
  fetchCompatibilityInvitation: mocks.fetchCompatibilityInvitation,
}));

vi.mock("../feature/liff", () => ({
  useLiffSession: () => ({ acquireIdToken: mocks.acquireIdToken }),
}));

describe("LIFF compatibility share link journey", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(screen.getByText("私は見通しを大切にします")).toBeTruthy();
    expect(mocks.fetchCompatibilityInvitation).toHaveBeenCalledWith(
      undefined,
      "recipient-token",
      relationshipId,
      expect.any(AbortSignal),
    );
  });
});
