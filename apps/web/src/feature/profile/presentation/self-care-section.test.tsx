// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LINE_OFFICIAL_ACCOUNT_URL } from "../../../model/line-official-account";
import type { SelfCareContextResult } from "../model/self-care-context";
import { SelfCareDetailsScreen } from "./self-care-details-screen";
import { SelfCareSection } from "./self-care-section";

const result: SelfCareContextResult = {
  items: [
    {
      id: "stress-trigger",
      brainItemId: "brain-stress-trigger",
      statement: "急な予定変更が重なると消耗しやすい",
      kind: "stress-trigger",
      status: "active",
      confirmedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "early-sign",
      brainItemId: "brain-early-sign",
      statement: "返信を後回しにし始める",
      kind: "early-sign",
      status: "active",
      confirmedAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
    {
      id: "worked-latest",
      brainItemId: "brain-worked-latest",
      statement: "予定を一つ減らすと少し楽になった",
      kind: "worked",
      status: "active",
      confirmedAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    },
    {
      id: "recent-state",
      brainItemId: "brain-recent-state",
      statement: "今週は肩に力が入っている",
      kind: "recent-state",
      status: "active",
      confirmedAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    {
      id: "did-not-work",
      brainItemId: "brain-did-not-work",
      statement: "長い散歩は余計に疲れた",
      kind: "did-not-work",
      status: "active",
      confirmedAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
  ],
  canManage: true,
};

describe("SelfCareSection", () => {
  it("SSoTの3項目へ本人が確認した各分類を最大1件表示する", () => {
    render(<SelfCareSection state={{ status: "success", data: result }} onRetry={vi.fn()} />);

    expect(screen.getByText("負荷の手がかり")).toBeDefined();
    expect(screen.getByText("早めのサイン")).toBeDefined();
    expect(screen.getByText("合いやすかったこと")).toBeDefined();
    expect(screen.getByText("急な予定変更が重なると消耗しやすい")).toBeDefined();
    expect(screen.getByText("返信を後回しにし始める")).toBeDefined();
    expect(screen.getByText("予定を一つ減らすと少し楽になった")).toBeDefined();
    expect(screen.queryByText("今週は肩に力が入っている")).toBeNull();
    expect(screen.queryByText("長い散歩は余計に疲れた")).toBeNull();
  });

  it("未登録項目を推定で埋めず、LINEで見つける・追加する操作を表示する", () => {
    render(
      <SelfCareSection
        state={{ status: "success", data: { items: [], canManage: true } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("link", { name: "AIと一緒に見つける" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "自分で追加する" })).toHaveProperty(
      "href",
      LINE_OFFICIAL_ACCOUNT_URL,
    );
  });

  it("詳細画面とLINE公式トークへの導線だけを置く", () => {
    render(<SelfCareSection state={{ status: "success", data: result }} onRetry={vi.fn()} />);

    expect(screen.getByRole("link", { name: "詳しく見る" })).toHaveProperty(
      "pathname",
      "/me/self-care",
    );
    expect(screen.getByRole("link", { name: "AIに聞く" })).toHaveProperty(
      "href",
      LINE_OFFICIAL_ACCOUNT_URL,
    );
  });
});

describe("SelfCareDetailsScreen", () => {
  it("確認済み情報をその分類のまま表示し、本人が撤回できる", () => {
    const onRevoke = vi.fn();
    render(
      <SelfCareDetailsScreen
        state={{ status: "success", data: result }}
        pendingId={null}
        operationError={null}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByText("今週は肩に力が入っている")).toBeDefined();
    expect(screen.getByText("長い散歩は余計に疲れた")).toBeDefined();
    const revokeButton = screen.getAllByRole("button", { name: "確認を取り消す" })[0];
    if (!revokeButton) throw new Error("revoke button is missing");
    fireEvent.click(revokeButton);
    expect(onRevoke).toHaveBeenCalledWith("stress-trigger");
    for (const link of screen.getAllByRole("link", { name: "AIに聞く" })) {
      expect(link).toHaveProperty("href", LINE_OFFICIAL_ACCOUNT_URL);
    }
  });

  it("未登録時はAIの推定を表示せず2つの開始操作を置く", () => {
    render(
      <SelfCareDetailsScreen
        state={{ status: "success", data: { items: [], canManage: true } }}
        pendingId={null}
        operationError={null}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText("確認済みのセルフケア情報はまだありません。")).toBeDefined();
    expect(screen.getByRole("link", { name: "AIと一緒に見つける" })).toBeDefined();
    expect(screen.getByRole("link", { name: "自分で追加する" })).toBeDefined();
  });
});
