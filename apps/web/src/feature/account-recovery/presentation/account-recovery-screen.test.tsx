// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountRecoveryScreen } from "./account-recovery-screen";

const { acquireIdToken, completeRecovery } = vi.hoisted(() => ({
  acquireIdToken: vi.fn(),
  completeRecovery: vi.fn(),
}));
vi.mock("../../liff", () => ({ useLiffSession: () => ({ acquireIdToken }) }));
vi.mock("../infrastructure/account-recovery-api", () => ({ completeRecovery }));

describe("AccountRecoveryScreen", () => {
  afterEach(cleanup);
  beforeEach(() => {
    acquireIdToken.mockReset().mockResolvedValue("new-line-token");
    completeRecovery
      .mockReset()
      .mockResolvedValue({ status: "recovered", alreadyRecovered: false });
  });

  it("復旧コードと新しいLINE tokenを送り、同じAccountへの接続完了を表示する", async () => {
    render(<AccountRecoveryScreen />);
    fireEvent.change(screen.getByLabelText("復旧コード"), {
      target: { value: "credential.secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "このLINE Accountへ接続" }));

    await waitFor(() =>
      expect(completeRecovery).toHaveBeenCalledWith(
        undefined,
        "new-line-token",
        "credential.secret",
      ),
    );
    expect(screen.getByText("同じAccountへ接続しました")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "復旧コードがない場合の解約・問い合わせ" })
        .getAttribute("href"),
    ).toBe("/contact");
  });
});
