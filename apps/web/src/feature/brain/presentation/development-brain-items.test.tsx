// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentBrainItems } from "./development-brain-items";

describe("DevelopmentBrainItems", () => {
  afterEach(cleanup);

  it("一覧の取得中はItemのSkeletonを表示する", () => {
    render(
      <DevelopmentBrainItems
        state={{ status: "loading" }}
        vectorStates={{}}
        onRetry={vi.fn()}
        onVerifyVector={vi.fn()}
      />,
    );

    const skeleton = screen.getByRole("status", { name: "Brain Item一覧を読み込み中" });
    expect(skeleton.classList.contains("block")).toBe(true);
    expect(skeleton.classList.contains("mt-5")).toBe(true);
    expect(skeleton.querySelector(".space-y-3")?.children).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Brain Item一覧" })).toBeTruthy();
  });

  it("active ItemとEvidenceを表示する", () => {
    const onVerifyVector = vi.fn();
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
                vectorSync: {
                  status: "applied",
                  operation: "upsert",
                  attemptCount: 1,
                  updatedAt: "2026-08-09T00:01:00.000Z",
                  hasEntry: true,
                  entryRevision: 1,
                },
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
        vectorStates={{
          "brain-1": {
            status: "success",
            data: {
              state: "present",
              entryRevision: 12,
              dimensions: 768,
              metadata: { category: "memory", derivation: "ai", embeddingVersion: 1 },
              checkedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        }}
        onRetry={vi.fn()}
        onVerifyVector={onVerifyVector}
      />,
    );

    expect(screen.getByRole("heading", { name: "Brain Item一覧" })).toBeTruthy();
    expect(screen.getByText("公園を散歩した")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("Vector同期受付済み")).toBeTruthy();
    expect(screen.getByText("Vectorizeに実体あり（768次元）")).toBeTruthy();
    expect(screen.getByText("memory / ai / embedding v1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vectorizeで実体確認" }));
    expect(onVerifyVector).toHaveBeenCalledWith("brain-1");
    fireEvent.click(screen.getByText("Evidence 1件"));
    expect(screen.getByText("source-1")).toBeTruthy();
  });

  it("0件を明示する", () => {
    render(
      <DevelopmentBrainItems
        state={{ status: "success", data: { items: [], truncated: false } }}
        vectorStates={{}}
        onRetry={vi.fn()}
        onVerifyVector={vi.fn()}
      />,
    );
    expect(screen.getByText("追加されたBrain Itemはありません")).toBeTruthy();
  });

  it("取得失敗から再試行できる", () => {
    const onRetry = vi.fn();
    render(
      <DevelopmentBrainItems
        state={{ status: "error", message: "取得できませんでした" }}
        vectorStates={{}}
        onRetry={onRetry}
        onVerifyVector={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
