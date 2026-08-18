import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeLiffWindow,
  initializeLiffForAuthExchange,
  openLiffWindow,
  readLiffAuthExchangeCredential,
  sendLiffTextMessage,
  shareLiffTextMessage,
} from "./liff-client";

const mockLiff = vi.hoisted(() => ({
  init: vi.fn(),
  isInClient: vi.fn(),
  isLoggedIn: vi.fn(),
  login: vi.fn(),
  getIDToken: vi.fn(),
  openWindow: vi.fn(),
  isApiAvailable: vi.fn(),
  shareTargetPicker: vi.fn(),
  sendMessages: vi.fn(),
  closeWindow: vi.fn(),
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

describe("initializeLiffForAuthExchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLiff.init.mockResolvedValue(undefined);
    mockLiff.isInClient.mockReturnValue(true);
    mockLiff.isLoggedIn.mockReturnValue(true);
  });

  it("liffId が未設定なら初期化をスキップして disabled を返すこと", async () => {
    const state = await initializeLiffForAuthExchange(undefined);

    expect(state).toEqual({ status: "disabled", reason: "VITE_LIFF_ID が未設定です" });
    expect(mockLiff.init).not.toHaveBeenCalled();
  });

  it("認証交換に必要な初期化だけでreadyを返すこと", async () => {
    const state = await initializeLiffForAuthExchange(LIFF_ID);

    expect(mockLiff.init).toHaveBeenCalledWith({ liffId: LIFF_ID });
    expect(state).toEqual({ status: "ready", inClient: true });
  });

  it("外部ブラウザで開かれた場合も ready を返し inClient が false になること", async () => {
    mockLiff.isInClient.mockReturnValue(false);

    const state = await initializeLiffForAuthExchange(LIFF_ID);

    expect(state).toMatchObject({ status: "ready", inClient: false });
  });

  it("未ログインなら環境判定用のinClientを保持してlogin-requiredを返すこと", async () => {
    mockLiff.isLoggedIn.mockReturnValue(false);

    const state = await initializeLiffForAuthExchange(LIFF_ID);

    expect(mockLiff.login).not.toHaveBeenCalled();
    expect(state).toEqual({ status: "login-required", inClient: true });
  });

  it("liff.init が失敗しても例外を投げず error を返すこと", async () => {
    mockLiff.init.mockRejectedValue(new Error("invalid liffId for U-secret"));

    const state = await initializeLiffForAuthExchange(LIFF_ID);

    expect(state.status).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("invalid liffId") });
    expect(loggerWarn).toHaveBeenCalledWith(
      { event: "liff.initialize.failed", outcome: "failed", reason: "sdk-error" },
      "LIFF の初期化に失敗しました",
    );
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("U-secret");
    expect(mockLiff.login).not.toHaveBeenCalled();
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

describe("self-care consultation LIFF message", () => {
  beforeEach(() => vi.clearAllMocks());

  it("LINE内では本人が選んだ相談文だけを現在のトークへ送って戻る", async () => {
    mockLiff.isInClient.mockReturnValue(true);
    mockLiff.isApiAvailable.mockReturnValue(true);
    mockLiff.sendMessages.mockResolvedValue(undefined);

    await expect(sendLiffTextMessage("今しんどい。何からすればいい？")).resolves.toBe(true);
    expect(mockLiff.sendMessages).toHaveBeenCalledWith([
      { type: "text", text: "今しんどい。何からすればいい？" },
    ]);
    expect(closeLiffWindow()).toBe(true);
    expect(mockLiff.closeWindow).toHaveBeenCalledOnce();
  });

  it("外部ブラウザでは送信せず、呼び出し側のcopy案内へ戻す", async () => {
    mockLiff.isInClient.mockReturnValue(false);

    await expect(sendLiffTextMessage("相談したい")).resolves.toBe(false);
    expect(mockLiff.sendMessages).not.toHaveBeenCalled();
    expect(closeLiffWindow()).toBe(false);
  });

  it("LINE送信に失敗しても本文をlogへ含めない", async () => {
    mockLiff.isInClient.mockReturnValue(true);
    mockLiff.isApiAvailable.mockReturnValue(true);
    mockLiff.sendMessages.mockRejectedValue(new Error("secret consultation body"));

    await expect(sendLiffTextMessage("機微な相談本文")).resolves.toBe(false);
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("機微な相談本文");
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("secret consultation body");
  });
});

describe("readLiffAuthExchangeCredential", () => {
  beforeEach(() => vi.clearAllMocks());

  it("認証交換用credentialを返すこと", () => {
    mockLiff.getIDToken.mockReturnValue("dummy.id.token");

    expect(readLiffAuthExchangeCredential()).toBe("dummy.id.token");
  });

  it("IDトークンを取得できない場合はnullを返すこと", () => {
    mockLiff.getIDToken.mockImplementation(() => {
      throw new Error("LIFF is not initialized");
    });

    expect(readLiffAuthExchangeCredential()).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      { event: "liff.id-token.failed", outcome: "failed", reason: "sdk-error" },
      "ID トークンを取得できませんでした",
    );
  });
});
