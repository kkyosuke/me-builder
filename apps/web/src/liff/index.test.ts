import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeLiff } from "./index";

const mockLiff = vi.hoisted(() => ({
  init: vi.fn(),
  isInClient: vi.fn(),
  isLoggedIn: vi.fn(),
  login: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("@line/liff", () => ({ default: mockLiff }));

const LIFF_ID = "1234567890-abcdefgh";

describe("initializeLiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiff.init.mockResolvedValue(undefined);
    mockLiff.isInClient.mockReturnValue(true);
    mockLiff.isLoggedIn.mockReturnValue(true);
    mockLiff.getProfile.mockResolvedValue({
      userId: "U0000000000000000000000000000000",
      displayName: "うつし",
      pictureUrl: "https://example.com/picture.jpg",
      statusMessage: "テスト",
    });
  });

  it("liffId が未設定なら初期化をスキップして disabled を返すこと", async () => {
    const state = await initializeLiff(undefined);

    expect(state).toEqual({ status: "disabled", reason: "VITE_LIFF_ID が未設定です" });
    expect(mockLiff.init).not.toHaveBeenCalled();
  });

  it("初期化とプロフィール取得に成功すれば ready を返すこと", async () => {
    const state = await initializeLiff(LIFF_ID);

    expect(mockLiff.init).toHaveBeenCalledWith({ liffId: LIFF_ID });
    expect(state).toEqual({
      status: "ready",
      inClient: true,
      profile: {
        displayName: "うつし",
        pictureUrl: "https://example.com/picture.jpg",
      },
    });
  });

  it("表示用プロフィールに userId と statusMessage を含めないこと", async () => {
    const state = await initializeLiff(LIFF_ID);

    if (state.status !== "ready") {
      throw new Error(`unexpected status: ${state.status}`);
    }
    expect(Object.keys(state.profile).sort()).toEqual(["displayName", "pictureUrl"]);
    expect(JSON.stringify(state)).not.toContain("U0000000000000000000000000000000");
  });

  it("外部ブラウザで開かれた場合も ready を返し inClient が false になること", async () => {
    mockLiff.isInClient.mockReturnValue(false);

    const state = await initializeLiff(LIFF_ID);

    expect(state).toMatchObject({ status: "ready", inClient: false });
  });

  it("未ログインならログイン画面へ遷移し login-required を返すこと", async () => {
    mockLiff.isLoggedIn.mockReturnValue(false);

    const state = await initializeLiff(LIFF_ID);

    expect(mockLiff.login).toHaveBeenCalledTimes(1);
    expect(mockLiff.getProfile).not.toHaveBeenCalled();
    expect(state).toEqual({ status: "login-required" });
  });

  it("liff.init が失敗しても例外を投げず error を返すこと", async () => {
    mockLiff.init.mockRejectedValue(new Error("invalid liffId"));

    const state = await initializeLiff(LIFF_ID);

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("invalid liffId") });
    expect(mockLiff.login).not.toHaveBeenCalled();
  });

  it("プロフィール取得が失敗しても例外を投げず error を返すこと", async () => {
    mockLiff.getProfile.mockRejectedValue(new Error("network error"));

    const state = await initializeLiff(LIFF_ID);

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("network error") });
  });
});
