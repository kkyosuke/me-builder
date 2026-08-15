// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceTermsStatus } from "../model/service-terms";
import { ServiceTermsScreen } from "./service-terms-screen";

const status: ServiceTermsStatus = {
  document: {
    documentKey: "terms_of_service",
    version: "2026-08-15",
    contentHash: "sha256:9e0143a66c525bc4784e2a6a5b0e16f511189e98b66f2da90dcb6d43cfe01836",
    requiresReacceptance: true,
    publishedAt: "2026-08-15T00:00:00+09:00",
    title: "うつし サービス利用規約",
    summary: "サービスの説明",
    sections: [{ heading: "1. 規約への同意", paragraphs: ["規約本文です。"] }],
  },
  acceptance: { required: true, acceptedVersion: null, documentHash: null, acceptedAt: null },
};

describe("ServiceTermsScreen", () => {
  afterEach(cleanup);

  it("規約versionと全文を表示し、明示確認まで同意できない", () => {
    const onAccept = vi.fn();
    render(<ServiceTermsScreen status={status} onAccept={onAccept} />);

    expect(screen.getByRole("heading", { name: "うつし サービス利用規約" })).toBeTruthy();
    expect(screen.getByText(/version 2026-08-15/)).toBeTruthy();
    expect(screen.getByText("規約本文です。")).toBeTruthy();
    const button = screen.getByRole("button", { name: "同意して利用を始める" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /利用規約の内容を確認/ }));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("同意済みの閲覧では同意日時を表示し、再同意ボタンを出さない", () => {
    render(
      <ServiceTermsScreen
        status={{
          ...status,
          acceptance: {
            required: false,
            acceptedVersion: status.document.version,
            documentHash: status.document.contentHash,
            acceptedAt: "2026-08-15T01:23:45.000Z",
          },
        }}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/同意済み/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "同意して利用を始める" })).toBeNull();
    expect(screen.getByRole("button", { name: "利用規約を閉じる" })).toBeTruthy();
  });
});
