// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalDataApplication } from "./personal-data-application";

const mocks = vi.hoisted(() => ({
  acquireIdToken: vi.fn().mockResolvedValue("id-token"),
  fetchRecords: vi.fn(),
  correctRecord: vi.fn(),
  deleteRecord: vi.fn(),
  requestExport: vi.fn(),
  fetchExport: vi.fn(),
  downloadExport: vi.fn(),
}));

vi.mock("../../liff", () => ({
  useLiffSession: () => ({ acquireIdToken: mocks.acquireIdToken }),
}));
vi.mock("../../liff/infrastructure/liff-client", () => ({
  getLiffIdToken: () => "id-token",
}));
vi.mock("../infrastructure/personal-data-api", () => ({
  fetchPersonalDataRecords: mocks.fetchRecords,
  correctPersonalDataRecord: mocks.correctRecord,
  deletePersonalDataRecord: mocks.deleteRecord,
  requestPersonalDataExport: mocks.requestExport,
  fetchPersonalDataExport: mocks.fetchExport,
  downloadPersonalDataExport: mocks.downloadExport,
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
    mocks.deleteRecord.mockResolvedValue({
      outcome: "deleted",
      recordId: "diary-source",
      invalidatedBrainItemCount: 0,
    });
    mocks.requestExport.mockResolvedValue({
      id: "export-1",
      status: "ready",
      requestedAt: "2026-08-15T03:00:00.000Z",
      completedAt: "2026-08-15T03:00:01.000Z",
      expiresAt: "2026-08-16T03:00:01.000Z",
      downloadUrl: "/api/personal-data/exports/export-1/download",
    });
    mocks.downloadExport.mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("Skeletonから本人入力を表示し、診断回答を訂正する", async () => {
    render(<PersonalDataApplication onBack={vi.fn()} />);

    expect(screen.getByRole("status", { name: "入力データを読み込んでいます" })).toBeTruthy();
    expect(await screen.findByText("朝は得意ですか？")).toBeTruthy();
    const correctButton = screen.getAllByRole("button", { name: "訂正" })[0];
    if (!correctButton) throw new Error("診断訂正buttonがありません");
    fireEvent.click(correctButton);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.correctRecord).toHaveBeenCalledWith(undefined, "id-token", "diagnosis-source", {
        kind: "diagnosis",
        choiceId: "yes",
      }),
    );
    expect(mocks.fetchRecords).toHaveBeenCalledTimes(2);
  });

  it("確認後に日記を一覧から削除する", async () => {
    render(<PersonalDataApplication onBack={vi.fn()} />);

    expect(await screen.findByText("今日の記録")).toBeTruthy();
    const deleteButton = screen.getAllByRole("button", { name: "削除" })[1];
    if (!deleteButton) throw new Error("日記削除buttonがありません");
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(mocks.deleteRecord).toHaveBeenCalledWith(undefined, "id-token", "diary-source"),
    );
    expect(screen.queryByText("今日の記録")).toBeNull();
  });

  it("料金プランに依存せず本人データを作成して認証付きでdownloadする", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:personal-data");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PersonalDataApplication onBack={vi.fn()} />);

    await screen.findByText("朝は得意ですか？");
    fireEvent.click(screen.getByRole("button", { name: "データを作成" }));
    expect(await screen.findByRole("button", { name: "ダウンロード" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ダウンロード" }));

    await waitFor(() =>
      expect(mocks.downloadExport).toHaveBeenCalledWith(undefined, "id-token", "export-1"),
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:personal-data");
  });
});
