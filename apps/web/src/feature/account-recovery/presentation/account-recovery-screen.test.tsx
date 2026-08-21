// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountRecoveryScreen } from "./account-recovery-screen";

const { authState, retryAuthSession, completeRecovery } = vi.hoisted(() => ({
  authState: {
    status: "authenticated" as const,
    profile: { displayName: "復旧する利用者" },
    role: "user" as const,
    revision: 1,
  },
  retryAuthSession: vi.fn(),
  completeRecovery: vi.fn(),
}));
vi.mock("../../auth", () => ({
  useAuthSession: () => ({ state: authState, retry: retryAuthSession }),
}));
vi.mock("../infrastructure/account-recovery-api", () => ({ completeRecovery }));

describe("AccountRecoveryScreen", () => {
  afterEach(cleanup);
  beforeEach(() => {
    retryAuthSession.mockReset().mockResolvedValue(authState);
    completeRecovery
      .mockReset()
      .mockResolvedValue({ status: "recovered", alreadyRecovered: false });
  });

  it("復旧コードをアプリセッションで送り、更新後の同じAccountへの接続完了を表示する", async () => {
    render(<AccountRecoveryScreen />);
    fireEvent.change(screen.getByLabelText("復旧コード"), {
      target: { value: "credential.secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "このLINE Accountへ接続" }));

    await waitFor(() =>
      expect(completeRecovery).toHaveBeenCalledWith(undefined, "credential.secret"),
    );
    expect(retryAuthSession).toHaveBeenCalledOnce();
    expect(screen.getByText("同じAccountへ接続しました")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "復旧コードがない場合の契約停止・問い合わせ" })
        .getAttribute("href"),
    ).toBe("/contact");
    expect(
      screen.getByText(/問い合わせでもAccountや保存済みデータの復旧は行いません/u),
    ).toBeTruthy();
  });

  it("復旧完了後に新しいセッションを確認できなければ旧セッションで完了表示しない", async () => {
    retryAuthSession.mockResolvedValue({ status: "unauthenticated", reason: "expired" });
    render(<AccountRecoveryScreen />);
    fireEvent.change(screen.getByLabelText("復旧コード"), {
      target: { value: "credential.secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "このLINE Accountへ接続" }));

    expect((await screen.findByRole("alert")).textContent).toContain("復旧後の本人確認を更新");
    expect(screen.queryByText("同じAccountへ接続しました")).toBeNull();
  });
});
