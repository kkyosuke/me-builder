import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLiffIdToken,
  initializeLiff,
  openLiffWindow,
  shareLiffTextMessage,
} from "./liff-client";

const mockLiff = vi.hoisted(() => ({
  init: vi.fn(),
  isInClient: vi.fn(),
  isLoggedIn: vi.fn(),
  login: vi.fn(),
  getProfile: vi.fn(),
  getIDToken: vi.fn(),
  openWindow: vi.fn(),
  isApiAvailable: vi.fn(),
  shareTargetPicker: vi.fn(),
}));
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@line/liff", () => ({ default: mockLiff }));
vi.mock("@me-builder/shared", () => ({
  logger: { info: vi.fn(), warn: loggerWarn },
}));

const LIFF_ID = "1234567890-abcdefgh";

describe("openLiffWindow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("LIFFブラウザではLINEのアプリ内ブラウザでURLを開く", () => {
    mockLiff.isInClient.mockReturnValue(true);

    expect(openLiffWindow("https://checkout.stripe.test/session")).toBe(true);
    expect(mockLiff.openWindow).toHaveBeenCalledWith({
      url: "https://checkout.stripe.test/session",
      external: false,
    });
  });

  it("外部ブラウザでは通常navigationへフォールバックさせる", () => {
    mockLiff.isInClient.mockReturnValue(false);

    expect(openLiffWindow("https://checkout.stripe.test/session")).toBe(false);
    expect(mockLiff.openWindow).not.toHaveBeenCalled();
  });

  it("LIFF SDKがURLを開けない場合も通常navigationへフォールバックさせる", () => {
    mockLiff.isInClient.mockReturnValue(true);
    mockLiff.openWindow.mockImplementation(() => {
      throw new Error("LIFF is not initialized");
    });

    expect(openLiffWindow("https://checkout.stripe.test/session")).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith(
      { event: "liff.window.open.failed", outcome: "failed", reason: "sdk-error" },
      "LIFF から外部 URL を開けませんでした",
    );
  });
});

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
    mockLiff.init.mockRejectedValue(new Error("invalid liffId for U-secret"));

    const state = await initializeLiff(LIFF_ID);

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("invalid liffId") });
    expect(loggerWarn).toHaveBeenCalledWith(
      { event: "liff.initialize.failed", outcome: "failed", reason: "sdk-error" },
      "LIFF の初期化に失敗しました",
    );
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("U-secret");
    expect(mockLiff.login).not.toHaveBeenCalled();
  });

  it("プロフィール取得が失敗しても例外を投げず error を返すこと", async () => {
    mockLiff.getProfile.mockRejectedValue(new Error("network error"));

    const state = await initializeLiff(LIFF_ID);

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("network error") });
  });
});

describe("shareLiffTextMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("共有先選択を利用できる場合はテキストメッセージだけを渡す", async () => {
    mockLiff.isApiAvailable.mockReturnValue(true);
    mockLiff.shareTargetPicker.mockResolvedValue({ status: "success" });

    await expect(shareLiffTextMessage("招待メッセージ")).resolves.toBe("sent");
    expect(mockLiff.shareTargetPicker).toHaveBeenCalledWith(
      [{ type: "text", text: "招待メッセージ" }],
      { isMultiple: false },
    );
  });

  it("共有先選択を閉じた場合はキャンセルを返す", async () => {
    mockLiff.isApiAvailable.mockReturnValue(true);
    mockLiff.shareTargetPicker.mockResolvedValue(undefined);

    await expect(shareLiffTextMessage("招待メッセージ")).resolves.toBe("cancelled");
  });

  it("共有先選択を利用できなければSDKを呼ばず同期的にnullを返す", () => {
    mockLiff.isApiAvailable.mockReturnValue(false);

    expect(shareLiffTextMessage("招待メッセージ")).toBeNull();
    expect(mockLiff.shareTargetPicker).not.toHaveBeenCalled();
  });
});

describe("getLiffIdToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("LIFF SDKのIDトークンを返すこと", () => {
    mockLiff.getIDToken.mockReturnValue("dummy.id.token");

    expect(getLiffIdToken()).toBe("dummy.id.token");
  });

  it("IDトークンを取得できない場合はnullを返すこと", () => {
    mockLiff.getIDToken.mockImplementation(() => {
      throw new Error("LIFF is not initialized");
    });

    expect(getLiffIdToken()).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      { event: "liff.id-token.failed", outcome: "failed", reason: "sdk-error" },
      "ID トークンを取得できませんでした",
    );
  });
});
