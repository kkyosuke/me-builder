// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosisAnswerSkeleton, DiagnosisResultSkeleton } from "./diagnosis-loading-skeleton";

describe("diagnosis detail skeletons", () => {
  afterEach(cleanup);

  it("回答画面の取得中は質問カードと選択肢の配置を示す", () => {
    render(<DiagnosisAnswerSkeleton />);

    const skeleton = screen.getByRole("status", { name: "診断回答を読み込み中" });
    expect(skeleton.querySelector(".h-80")).toBeTruthy();
    expect(skeleton.querySelector(".grid-cols-2")).toBeTruthy();
  });

  it("結果画面の取得中は傾向の軸と回答内容の配置を示す", () => {
    render(<DiagnosisResultSkeleton />);

    const skeleton = screen.getByRole("status", { name: "診断結果を読み込み中" });
    expect(skeleton.querySelectorAll(".py-3\\.5")).toHaveLength(3);
    expect(skeleton.querySelector(".h-14")).toBeTruthy();
  });
});
