// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompatibilityShareContentSectionScreen } from "./compatibility-share-content-section";

describe("CompatibilityShareContentSectionScreen", () => {
  afterEach(cleanup);

  it("カテゴリと実際に共有される文章・診断テーマを表示する", () => {
    const onCategoryChange = vi.fn();
    render(
      <CompatibilityShareContentSectionScreen
        relationshipCategory="partner"
        state={{
          status: "success",
          data: {
            relationshipCategory: "partner",
            aboutMe: {
              profileSummaryVersionId: "summary-version-1",
              generatedAt: "2026-08-15T00:00:00.000Z",
              statements: [
                {
                  key: "core-values",
                  label: "まず知ってほしいこと",
                  statement: "私は、一緒に楽しむ時間を大切にしたいです",
                },
              ],
            },
            themes: [
              {
                diagnosisId: "planning",
                title: "時間と予定",
                parameters: [
                  {
                    id: "timing",
                    label: "予定を決めるタイミング",
                    lowLabel: "その場で決めたい",
                    highLabel: "早めに決めたい",
                    position: 72,
                    statement: "私は、予定を早めに決めておけると安心します。",
                  },
                ],
              },
            ],
            nextAction: null,
          },
        }}
        onRelationshipCategoryChange={onCategoryChange}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "うつしで共有される内容" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "パートナー" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("「私は、一緒に楽しむ時間を大切にしたいです」")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "時間と予定" })).toBeTruthy();
    expect(screen.getByText("私は、予定を早めに決めておけると安心します。")).toBeTruthy();
    expect(screen.getByText(/生の回答、日記や会話/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "家族" }));
    expect(onCategoryChange).toHaveBeenCalledWith("family");
  });

  it("テーマがない場合は選択カテゴリの診断へ案内する", () => {
    render(
      <CompatibilityShareContentSectionScreen
        relationshipCategory="friend"
        state={{
          status: "success",
          data: {
            relationshipCategory: "friend",
            aboutMe: null,
            themes: [],
            nextAction: "profile-summary",
          },
        }}
        onRelationshipCategoryChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("共有できる「私について」はまだありません")).toBeTruthy();
    expect(screen.getByRole("link", { name: "友達の診断を見る" }).getAttribute("href")).toBe(
      "/diagnosis?category=friend",
    );
  });
});
