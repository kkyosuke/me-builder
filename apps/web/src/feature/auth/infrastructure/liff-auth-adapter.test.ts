import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeLiffForAuthExchange: vi.fn(),
  readCredential: vi.fn(),
  redirectToLogin: vi.fn(),
  exchangeLiffCredential: vi.fn(),
}));

vi.mock("../../liff/infrastructure/liff-client", () => ({
  initializeLiffForAuthExchange: mocks.initializeLiffForAuthExchange,
  readLiffAuthExchangeCredential: mocks.readCredential,
  redirectToLiffLogin: mocks.redirectToLogin,
}));
vi.mock("./auth-session-api", () => ({
  exchangeLiffCredential: mocks.exchangeLiffCredential,
}));

import { detectAuthEntryEnvironment, establishLiffAuthSession } from "./liff-auth-adapter";

describe("establishLiffAuthSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "ready",
      inClient: true,
    });
    mocks.readCredential.mockReturnValue("secret.id.token");
    mocks.exchangeLiffCredential.mockResolvedValue({
      authenticated: true,
      displayProfile: { displayName: "テスト" },
      role: "user",
      csrfToken: "csrf-token",
    });
  });

  it("credentialを認証交換APIだけへ渡す", async () => {
    const signal = new AbortController().signal;

    await expect(
      establishLiffAuthSession("https://api.example.com", "test-liff-id", signal),
    ).resolves.toMatchObject({ authenticated: true });

    expect(mocks.initializeLiffForAuthExchange).toHaveBeenCalledWith("test-liff-id");
    expect(mocks.exchangeLiffCredential).toHaveBeenCalledWith(
      "https://api.example.com",
      "secret.id.token",
      signal,
    );
  });

  it("同時の交換要求ではLIFF初期化だけを共有する", async () => {
    let finishInitialization: ((state: unknown) => void) | undefined;
    mocks.initializeLiffForAuthExchange.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInitialization = resolve;
        }),
    );
    const signal = new AbortController().signal;

    const first = establishLiffAuthSession(undefined, "test-liff-id", signal);
    const second = establishLiffAuthSession(undefined, "test-liff-id", signal);
    expect(mocks.initializeLiffForAuthExchange).toHaveBeenCalledTimes(1);
    finishInitialization?.({
      status: "ready",
      inClient: true,
    });

    await Promise.all([first, second]);
    expect(mocks.exchangeLiffCredential).toHaveBeenCalledTimes(2);
  });

  it("ログイン遷移中はcredentialを読まずfeature requestを止める", async () => {
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "login-required",
      inClient: true,
    });

    await expect(
      establishLiffAuthSession(undefined, "test-liff-id", new AbortController().signal),
    ).resolves.toEqual({ redirecting: true });
    expect(mocks.redirectToLogin).toHaveBeenCalledOnce();
    expect(mocks.readCredential).not.toHaveBeenCalled();
    expect(mocks.exchangeLiffCredential).not.toHaveBeenCalled();
  });

  it("LIFF内・外部ブラウザをSDK結果で一意に判定する", async () => {
    await expect(detectAuthEntryEnvironment("test-liff-id")).resolves.toMatchObject({
      kind: "liff",
    });
    mocks.initializeLiffForAuthExchange.mockResolvedValue({
      status: "ready",
      inClient: false,
    });
    await expect(detectAuthEntryEnvironment("test-liff-id")).resolves.toMatchObject({
      kind: "external",
    });
  });
});
