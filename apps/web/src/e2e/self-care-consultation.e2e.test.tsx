// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileApplication from "../feature/profile/presentation/profile-application";
import { LINE_OFFICIAL_ACCOUNT_URL } from "../model/line-official-account";

const hookCalls = vi.hoisted(() => ({
  goalFollowUps: vi.fn(),
  profileProgression: vi.fn(),
  profileSummary: vi.fn(),
  selfCareContexts: vi.fn(),
  weeklyReflection: vi.fn(),
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
  useProfileSummary: () => {
    hookCalls.profileSummary();
    return {
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
      deleteVersion: vi.fn(),
    };
  },
}));
vi.mock("../feature/profile/presentation/use-profile-progression", () => ({
  useProfileProgression: () => {
    hookCalls.profileProgression();
    return { state: { status: "loading" }, reload: vi.fn() };
  },
}));
vi.mock("../feature/profile/presentation/use-weekly-reflection", () => ({
  useWeeklyReflection: () => {
    hookCalls.weeklyReflection();
    return { state: { status: "loading" }, generate: vi.fn() };
  },
}));
vi.mock("../feature/profile/presentation/use-goal-follow-ups", () => ({
  useGoalFollowUps: () => {
    hookCalls.goalFollowUps();
    return {
      state: { status: "loading" },
      pendingId: null,
      operationError: null,
      reload: vi.fn(),
      agree: vi.fn(),
      update: vi.fn(),
    };
  },
}));
vi.mock("../feature/profile/presentation/use-self-care-contexts", () => ({
  useSelfCareContexts: () => {
    hookCalls.selfCareContexts();
    return {
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
      operationNotice: null,
      reload: vi.fn(),
      revoke: vi.fn(),
    };
  },
}));

describe("self-care consultation user journey", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/me");
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it("詳しく見るから詳細へ進み、ブラウザ履歴でわたしのまとめへ戻る", async () => {
    const view = render(<ProfileApplication />);

    fireEvent.click(screen.getByRole("link", { name: "詳しく見る" }));
    view.rerender(<ProfileApplication />);
    expect(screen.getByRole("heading", { level: 1, name: "わたしのセルフケア" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "わたしのまとめへ戻る" }));
    await waitFor(() => expect(window.location.pathname).toBe("/me"));
    view.rerender(<ProfileApplication />);
    expect(window.location.pathname).toBe("/me");
    expect(screen.getByRole("link", { name: "詳しく見る" })).toBeDefined();
  });

  it("詳細URLへの直接遷移では無関係なsummary API hookを呼ばない", () => {
    window.history.replaceState({}, "", "/me/self-care");

    render(<ProfileApplication />);

    expect(hookCalls.selfCareContexts).toHaveBeenCalledOnce();
    expect(hookCalls.profileSummary).not.toHaveBeenCalled();
    expect(hookCalls.profileProgression).not.toHaveBeenCalled();
    expect(hookCalls.weeklyReflection).not.toHaveBeenCalled();
    expect(hookCalls.goalFollowUps).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "わたしのまとめへ戻る" }));
    expect(window.location.pathname).toBe("/me");
  });

  it("まとめと個別情報のAIに聞くは本文を持たない同じLINE公式トークを開く", () => {
    const view = render(<ProfileApplication />);
    expect(screen.getByRole("link", { name: "AIに聞く" })).toHaveProperty(
      "href",
      LINE_OFFICIAL_ACCOUNT_URL,
    );

    fireEvent.click(screen.getByRole("link", { name: "詳しく見る" }));
    view.rerender(<ProfileApplication />);
    for (const link of screen.getAllByRole("link", { name: "AIに聞く" })) {
      expect(link).toHaveProperty("href", LINE_OFFICIAL_ACCOUNT_URL);
      expect((link as HTMLAnchorElement).search).toBe("");
      expect((link as HTMLAnchorElement).hash).toBe("");
    }
  });
});
