// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FamilySeatApplication from "../feature/family/presentation/family-seat-application";

const mocks = vi.hoisted(() => ({
  fetchFamilySeats: vi.fn(),
  issueFamilyInvitation: vi.fn(),
  acceptFamilyInvitation: vi.fn(),
  declineFamilyInvitation: vi.fn(),
  cancelFamilyInvitation: vi.fn(),
  removeFamilyMember: vi.fn(),
  leaveFamilyPack: vi.fn(),
}));

vi.mock("../feature/family/infrastructure/family-api", () => ({
  fetchFamilySeats: mocks.fetchFamilySeats,
  issueFamilyInvitation: mocks.issueFamilyInvitation,
  acceptFamilyInvitation: mocks.acceptFamilyInvitation,
  declineFamilyInvitation: mocks.declineFamilyInvitation,
  cancelFamilyInvitation: mocks.cancelFamilyInvitation,
  removeFamilyMember: mocks.removeFamilyMember,
  leaveFamilyPack: mocks.leaveFamilyPack,
}));

const payerSeat = {
  id: "payer-seat",
  slotNumber: 1,
  role: "payer" as const,
  status: "active" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};
const memberSeat = {
  id: "member-seat",
  slotNumber: 2,
  role: "member" as const,
  status: "active" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T01:00:00.000Z",
};

describe("family seat user journey", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/profile/family");
    mocks.fetchFamilySeats.mockResolvedValue({ role: "payer", maxSeats: 4, seats: [payerSeat] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("支払者の招待発行から参加者の承諾・退出・Free復帰まで完了する", async () => {
    mocks.issueFamilyInvitation.mockResolvedValue({
      token: "a".repeat(43),
      expiresAt: "2026-08-18T00:00:00.000Z",
      seat: { ...memberSeat, status: "invited" },
    });
    const payer = render(<FamilySeatApplication onBack={vi.fn()} />);
    expect(await screen.findByText("使用中 1 / 4 Account")).toBeTruthy();
    expect(screen.getByText(/支払者は参加者の個人内容を閲覧できません/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新しい招待リンクを作る" }));
    expect(await screen.findByText("48時間有効な招待リンク")).toBeTruthy();
    expect(screen.getByText(new RegExp(`token=${"a".repeat(43)}`))).toBeTruthy();
    payer.unmount();

    window.history.replaceState({}, "", `/profile/family?token=${"a".repeat(43)}`);
    mocks.acceptFamilyInvitation.mockResolvedValue(memberSeat);
    mocks.fetchFamilySeats.mockResolvedValue({ role: "member", maxSeats: 4, seats: [memberSeat] });
    render(<FamilySeatApplication onBack={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "ファミリーパックへの招待" })).toBeTruthy();
    expect(screen.getByText(/支払者に日記、診断、プロフィールは共有されません/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "招待を承諾する" }));
    expect(await screen.findByRole("heading", { name: "参加中です" })).toBeTruthy();
    expect(screen.getByText("付与元: ファミリーパック")).toBeTruthy();
    expect(window.location.search).toBe("");

    mocks.leaveFamilyPack.mockResolvedValue({ ...memberSeat, status: "left" });
    fireEvent.click(screen.getByRole("button", { name: "ファミリーパックから退出する" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "現在のプラン: Free" })).toBeTruthy(),
    );
    expect(screen.getByText(/本人データはそのまま残ります/)).toBeTruthy();
  });

  it("招待辞退後に使用済みtokenをブラウザ履歴へ残さない", async () => {
    window.history.replaceState({}, "", `/profile/family?token=${"b".repeat(43)}&source=line`);
    mocks.declineFamilyInvitation.mockResolvedValue({ ...memberSeat, status: "cancelled" });
    render(<FamilySeatApplication onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "辞退する" }));
    expect(await screen.findByText("招待を辞退しました。")).toBeTruthy();
    expect(window.location.search).toBe("?source=line");
  });

  it("Account切替で画面を破棄したら席一覧の取得を中断する", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.fetchFamilySeats.mockImplementationOnce(
      (_apiUrl: string | undefined, signal: AbortSignal) => {
        requestSignal = signal;
        return new Promise(() => undefined);
      },
    );
    const view = render(<FamilySeatApplication onBack={vi.fn()} />);
    await waitFor(() => expect(requestSignal).toBeDefined());

    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
