// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentBrainItems } from "./development-brain-items";

describe("DevelopmentBrainItems", () => {
  afterEach(cleanup);

  it("active ItemとEvidenceを表示する", () => {
    render(
      <DevelopmentBrainItems
        state={{
          status: "success",
          data: {
            items: [
              {
                id: "brain-1",
                category: "memory",
                statement: "公園を散歩した",
                derivation: "ai",
                status: "active",
                createdAt: "2026-08-09T00:00:00.000Z",
                evidence: [
                  {
                    sourceRecordId: "source-1",
                    relation: "supports",
                    derivationMethod: "ai",
                    generatedAt: "2026-08-09T00:00:01.000Z",
                  },
                ],
              },
            ],
            truncated: false,
          },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Brain Item一覧" })).toBeTruthy();
    expect(screen.getByText("公園を散歩した")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    fireEvent.click(screen.getByText("Evidence 1件"));
    expect(screen.getByText("source-1")).toBeTruthy();
  });

  it("0件を明示する", () => {
    render(
      <DevelopmentBrainItems
        state={{ status: "success", data: { items: [], truncated: false } }}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("追加されたBrain Itemはありません")).toBeTruthy();
  });

  it("取得失敗から再試行できる", () => {
    const onRetry = vi.fn();
    render(
      <DevelopmentBrainItems
        state={{ status: "error", message: "取得できませんでした" }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
