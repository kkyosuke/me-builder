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
        onRevoke={onRevoke}
        onConsult={vi.fn()}
      />,
    );
    expect(screen.getByText("予定を一つ減らすと少し楽になった")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "確認を取り消す" }));
    expect(onRevoke).toHaveBeenCalledWith("self-care-1");
  });

  it("更新中は別の確認済み情報を含むすべての撤回操作を止める", () => {
    const firstItem = result.items[0];
    if (!firstItem) throw new Error("fixture is missing");
    render(
      <SelfCareSection
        state={{
          status: "success",
          data: {
            ...result,
            items: [...result.items, { ...firstItem, id: "self-care-2", kind: "did-not-work" }],
          },
        }}
        pendingId="self-care-1"
        operationError={null}
        onRetry={vi.fn()}
        onRevoke={vi.fn()}
        onConsult={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole("button", { name: "確認を取り消す" })) {
      expect(button).toHaveProperty("disabled", true);
    }
  });

  it("Freeでは一般案を使うことを案内し、管理操作を出さない", () => {
    render(
      <SelfCareSection
        state={{ status: "success", data: { ...result, canManage: false } }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onRevoke={vi.fn()}
        onConsult={vi.fn()}
      />,
    );
    expect(screen.getByText(/Freeの相談では一般的な案/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "確認を取り消す" })).toBeNull();
  });

  it("操作エラーを支援技術へ通知する", () => {
    render(
      <SelfCareSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError="撤回できませんでした。"
        onRetry={vi.fn()}
        onRevoke={vi.fn()}
        onConsult={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("撤回できませんでした");
  });

  it("選んだ相談目的をLINEへ送り、安全切替を事前に案内する", async () => {
    const onConsult = vi.fn().mockResolvedValue("sent");
    render(
      <SelfCareSection
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError={null}
        onRetry={vi.fn()}
        onRevoke={vi.fn()}
        onConsult={onConsult}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "今しんどい。何からすればいい？" }));
    expect(onConsult).toHaveBeenCalledWith("今しんどい。何からすればいい？");
    expect(screen.getByText(/緊急性が高い内容では/u)).toBeDefined();
  });
});
