// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GoalFollowUpResult } from "../model/goal-follow-up";
import { GoalFollowUpSection } from "./goal-follow-up-section";

const result: GoalFollowUpResult = {
  items: [
    {
      id: "follow-1",
      brainItemId: "goal-1",
      goal: "面談で希望を伝える",
      nextStep: "希望を一つ書く",
      status: "active",
      agreedAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    },
  ],
  candidates: [{ brainItemId: "goal-2", goal: "週末に歩く" }],
  canManage: true,
  activeLimit: null,
};

describe("GoalFollowUpSection", () => {
  it("本人が選んだ次の一歩を訂正・完了・停止できる", () => {
    const onUpdate = vi.fn();
    render(
      <GoalFollowUpSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onAgree={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByLabelText("次の小さな一歩"), {
      target: { value: "希望を二つ書く" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    expect(onUpdate).toHaveBeenNthCalledWith(1, "follow-1", { nextStep: "希望を二つ書く" });
    expect(onUpdate).toHaveBeenNthCalledWith(2, "follow-1", { status: "completed" });
  });

  it("候補のGoalへ小さな一歩を入力して合意できる", () => {
    const onAgree = vi.fn();
    render(
      <GoalFollowUpSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onAgree={onAgree}
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("最初の小さな一歩"), {
      target: { value: "土曜の朝に靴を出す" },
    });
    fireEvent.click(screen.getByRole("button", { name: "この行動を続ける" }));
    expect(onAgree).toHaveBeenCalledWith("goal-2", "土曜の朝に靴を出す");
  });

  it("Freeでは保存済み状態だけを表示する", () => {
    render(
      <GoalFollowUpSection
        state={{ status: "success", data: { ...result, canManage: false } }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onAgree={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText(/新しいフォローアップと変更はLite以上/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "完了" })).toBeNull();
  });

  it("更新中は別のGoal候補を含むすべての変更操作を止める", () => {
    render(
      <GoalFollowUpSection
        state={{ status: "success", data: result }}
        pendingId="follow-1"
        operationError={null}
        onRetry={vi.fn()}
        onAgree={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "完了" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "この行動を続ける" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("操作エラーを支援技術へ通知する", () => {
    render(
      <GoalFollowUpSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError="更新できませんでした。"
        onRetry={vi.fn()}
        onAgree={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("更新できませんでした");
  });

  it("停止したGoalだけを本人が再開でき、完了したGoalは再開できない", () => {
    const onUpdate = vi.fn();
    render(
      <GoalFollowUpSection
        state={{
          status: "success",
          data: {
            ...result,
            items: [
              { ...result.items[0], id: "stopped", status: "stopped" },
              { ...result.items[0], id: "completed", status: "completed" },
            ],
          },
        }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onAgree={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "再開" }));
    expect(onUpdate).toHaveBeenCalledWith("stopped", { status: "active" });
    expect(screen.getAllByText("完了")).toHaveLength(1);
  });
});
