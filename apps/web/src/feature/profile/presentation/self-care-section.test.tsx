// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SelfCareContextResult } from "../model/self-care-context";
import { SelfCareSection } from "./self-care-section";

const result: SelfCareContextResult = {
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
  candidates: [{ brainItemId: "brain-2", statement: "今週は肩に力が入っている" }],
  canManage: true,
};

describe("SelfCareSection", () => {
  it("確認済み情報を表示し、本人が撤回できる", () => {
    const onRevoke = vi.fn();
    render(
      <SelfCareSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onConfirm={vi.fn()}
        onRevoke={onRevoke}
      />,
    );
    expect(screen.getByText("予定を一つ減らすと少し楽になった")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "確認を取り消す" }));
    expect(onRevoke).toHaveBeenCalledWith("self-care-1");
  });

  it("本人が話した候補の意味を選んで確認できる", () => {
    const onConfirm = vi.fn();
    render(
      <SelfCareSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onConfirm={onConfirm}
        onRevoke={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("話したことからセルフケアへ追加"));
    fireEvent.click(screen.getByRole("button", { name: "最近の状態" }));
    expect(onConfirm).toHaveBeenCalledWith("brain-2", "recent-state");
  });

  it("Freeでは一般案を使うことを案内し、管理操作を出さない", () => {
    render(
      <SelfCareSection
        state={{ status: "success", data: { ...result, canManage: false } }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onConfirm={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByText(/Freeの相談では一般的な案/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "確認を取り消す" })).toBeNull();
  });
});
