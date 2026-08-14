// @vitest-environment jsdom

import type { CompatibilityRelationshipCategory } from "@me-builder/lib/compatibility";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompatibilityShareApplication from "./compatibility-share-application";

const mocks = vi.hoisted(() => ({
  screenProps: null as null | {
    onShareToLine: (url: string) => void;
    relationshipCategory: CompatibilityRelationshipCategory;
  },
  shareCompatibilityInvitationToLine: vi.fn(),
}));

vi.mock("../../liff", () => ({ useLiffSession: () => ({ acquireIdToken: vi.fn() }) }));
vi.mock("../infrastructure/compatibility-invitation-sharing", () => ({
  copyCompatibilityInvitationUrl: vi.fn(),
  shareCompatibilityInvitationToLine: mocks.shareCompatibilityInvitationToLine,
}));
vi.mock("./compatibility-share-screen", () => ({
  CompatibilityShareScreen: (props: {
    onShareToLine: (url: string) => void;
    relationshipCategory: CompatibilityRelationshipCategory;
  }) => {
    mocks.screenProps = props;
    return null;
  },
}));
vi.mock("./hooks/use-compatibility-invitation-issue", () => ({
  useCompatibilityInvitationIssue: () => ({
    state: {
      status: "success",
      data: {
        invitationUrl: "https://example.com/invitation",
        expiresAt: "2026-08-26T00:00:00.000Z",
        relationshipCategory: "family",
      },
    },
    issue: vi.fn(),
  }),
}));
vi.mock("./hooks/use-compatibility-share-consent", () => ({
  useCompatibilityShareConsent: () => ({
    state: {
      status: "success",
      data: {
        displayName: "うさぎ",
        avatarUrl: null,
        canShare: true,
        blockingReasons: [],
        nextAction: null,
      },
    },
    reload: vi.fn(),
  }),
}));

describe("CompatibilityShareApplication", () => {
  afterEach(() => {
    cleanup();
    mocks.screenProps = null;
    vi.clearAllMocks();
  });

  it("共有画面ではパートナーを初期選択する", () => {
    render(<CompatibilityShareApplication />);

    expect(mocks.screenProps?.relationshipCategory).toBe("partner");
  });

  it("共有処理中の連打では共有先を二重に開かない", () => {
    mocks.shareCompatibilityInvitationToLine.mockReturnValue(new Promise(() => undefined));
    render(<CompatibilityShareApplication />);

    const onShareToLine = mocks.screenProps?.onShareToLine;
    if (!onShareToLine) throw new Error("share callback was not rendered");

    act(() => {
      onShareToLine("https://example.com/invitation");
      onShareToLine("https://example.com/invitation");
    });

    expect(mocks.shareCompatibilityInvitationToLine).toHaveBeenCalledOnce();
    expect(mocks.shareCompatibilityInvitationToLine).toHaveBeenCalledWith(
      "うさぎ",
      "family",
      "https://example.com/invitation",
    );
  });
});
