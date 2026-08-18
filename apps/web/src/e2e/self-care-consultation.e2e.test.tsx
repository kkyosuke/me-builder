// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileApplication from "../feature/profile/presentation/profile-application";

const liff = vi.hoisted(() => ({
  sendText: vi.fn(),
  closeWindow: vi.fn(),
}));

vi.mock("../feature/liff", () => ({
  sendLiffTextMessage: liff.sendText,
  closeLiffWindow: liff.closeWindow,
}));
vi.mock("../feature/compatibility", () => ({ CompatibilityShareContentSection: () => null }));
vi.mock("../feature/profile/presentation/profile-summary-screen", () => ({
  ProfileSummaryScreen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../feature/profile/presentation/weekly-reflection-section", () => ({
  WeeklyReflectionSection: () => null,
}));
vi.mock("../feature/profile/presentation/goal-follow-up-section", () => ({
  GoalFollowUpSection: () => null,
}));
vi.mock("../feature/profile/presentation/use-profile-summary", () => ({
  useProfileSummary: () => ({
    state: {
      status: "success",
      data: {
        versions: [],
        availableDataCounts: { diagnosis: 0, diary: 0 },
        generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
      },
    },
    generationNotice: null,
    reload: vi.fn(),
    generate: vi.fn(),
    setSelfView: vi.fn(),
  }),
}));
vi.mock("../feature/profile/presentation/use-profile-progression", () => ({
  useProfileProgression: () => ({ state: { status: "loading" }, reload: vi.fn() }),
}));
vi.mock("../feature/profile/presentation/use-weekly-reflection", () => ({
  useWeeklyReflection: () => ({ state: { status: "loading" }, generate: vi.fn() }),
}));
vi.mock("../feature/profile/presentation/use-goal-follow-ups", () => ({
  useGoalFollowUps: () => ({
    state: { status: "loading" },
    pendingId: null,
    operationError: null,
    reload: vi.fn(),
    agree: vi.fn(),
    update: vi.fn(),
  }),
}));
vi.mock("../feature/profile/presentation/use-self-care-contexts", () => ({
  useSelfCareContexts: () => ({
    state: {
      status: "success",
      data: {
        canManage: true,
        items: [
          {
            id: "self-care-1",
            brainItemId: "brain-1",
            statement: "予定を一つ減らすと少し楽になった",
            kind: "worked",
            status: "active",
            confirmedAt: "2026-08-18T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
          },
        ],
      },
    },
    pendingId: null,
    operationError: null,
    reload: vi.fn(),
    revoke: vi.fn(),
  }),
}));

describe("self-care consultation user journey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liff.closeWindow.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("相談目的を現在のLINEトークへ送信してLIFFを閉じる", async () => {
    liff.sendText.mockResolvedValue(true);
    render(<ProfileApplication />);

    fireEvent.click(screen.getByRole("button", { name: "自分に合いそうな休み方を一緒に考えたい" }));

    expect(await screen.findByText("LINEのトークへ相談文を送信しました。")).toBeDefined();
    expect(liff.sendText).toHaveBeenCalledWith("自分に合いそうな休み方を一緒に考えたい");
    expect(liff.closeWindow).toHaveBeenCalledOnce();
  });

  it("LINE外では送信せず相談文をclipboardへ渡す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    liff.sendText.mockResolvedValue(false);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ProfileApplication />);

    fireEvent.click(screen.getByRole("button", { name: "今しんどい。何からすればいい？" }));

    expect(await screen.findByText(/相談文をコピーしました/u)).toBeDefined();
    expect(writeText).toHaveBeenCalledWith("今しんどい。何からすればいい？");
    expect(liff.closeWindow).not.toHaveBeenCalled();
  });
});
