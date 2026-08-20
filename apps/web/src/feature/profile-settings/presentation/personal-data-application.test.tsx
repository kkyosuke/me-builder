// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalDataApplication } from "./personal-data-application";

const mocks = vi.hoisted(() => ({
  fetchRecords: vi.fn(),
  fetchFeatures: vi.fn(),
  correctRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock("../infrastructure/personal-data-api", () => ({
  fetchPersonalDataRecords: mocks.fetchRecords,
  fetchPersonalDataFeatures: mocks.fetchFeatures,
  correctPersonalDataRecord: mocks.correctRecord,
  deletePersonalDataRecord: mocks.deleteRecord,
}));

describe("PersonalDataApplication", () => {
  beforeEach(() => {
    mocks.fetchRecords.mockResolvedValue([
      {
        id: "diagnosis-source",
        kind: "diagnosis",
        title: "朝は得意ですか？",
        value: "いいえ",
        recordedAt: "2026-08-15T01:00:00.000Z",
        diagnosisId: "diagnosis-1",
        choices: [
          { id: "no", label: "いいえ" },
          { id: "yes", label: "はい" },
        ],
      },
      {
        id: "diary-source",
        kind: "diary",
        title: "日記",
        value: "今日の記録",
        recordedAt: "2026-08-15T02:00:00.000Z",
      },
    ]);
    mocks.correctRecord.mockResolvedValue({
      outcome: "updated",
      recordId: "corrected-source",
      invalidatedBrainItemCount: 0,
    });
    mocks.fetchFeatures.mockResolvedValue({
      format: "kagami-brain-features",
      formatVersion: 1,
      generatedAt: "2026-08-21T00:00:00.000Z",
      scopes: ["metadata", "active", "history"],
      brainItems: [],
    });
    mocks.deleteRecord.mockResolvedValue({
      outcome: "deleted",
      recordId: "diary-source",
      invalidatedBrainItemCount: 0,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("Skeletonから本人入力を表示し、診断回答を読取専用にする", async () => {
    render(<PersonalDataApplication onBack={vi.fn()} />);

    expect(screen.getByRole("status", { name: "入力データを読み込んでいます" })).toBeTruthy();
    expect(await screen.findByText("朝は得意ですか？")).toBeTruthy();
    expect(screen.getByText("確定済みの診断回答は変更・個別削除できません。")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "訂正" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "削除" })).toHaveLength(1);
    expect(mocks.correctRecord).not.toHaveBeenCalled();
  });

  it("確認後に日記を一覧から削除する", async () => {
    render(<PersonalDataApplication onBack={vi.fn()} />);

    expect(await screen.findByText("今日の記録")).toBeTruthy();
    const deleteButton = screen.getByRole("button", { name: "削除" });
    if (!deleteButton) throw new Error("日記削除buttonがありません");
    fireEvent.click(deleteButton);

    await waitFor(() => expect(mocks.deleteRecord).toHaveBeenCalledWith(undefined, "diary-source"));
    expect(screen.queryByText("今日の記録")).toBeNull();
  });

  it("匿名化済みのBrain特徴JSONを書き出す", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURL = vi.fn().mockReturnValue("blob:brain-features");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    render(<PersonalDataApplication onBack={vi.fn()} />);

    await screen.findByText("朝は得意ですか？");
    fireEvent.click(screen.getByRole("button", { name: "Brain特徴JSONを書き出す" }));

    await waitFor(() => expect(mocks.fetchFeatures).toHaveBeenCalledWith(undefined));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:brain-features");
  });
});
