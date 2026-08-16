import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeLiffForAuthExchange: vi.fn(),
  readCredential: vi.fn(),
  exchangeLiffCredential: vi.fn(),
}));

vi.mock("../../liff/infrastructure/liff-client", () => ({
  initializeLiffForAuthExchange: mocks.initializeLiffForAuthExchange,
  readLiffAuthExchangeCredential: mocks.readCredential,
}));
vi.mock("./auth-session-api", () => ({
  exchangeLiffCredential: mocks.exchangeLiffCredential,
}));

import { establishLiffAuthSession } from "./liff-auth-adapter";

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
      profile: { displayName: "テスト" },
      role: "user",
      csrfToken: "csrf-token",
    });
  });

  it("credentialを認証交換APIだけへ渡す", async () => {
    const signal = new AbortController().signal;

    await expect(
      establishLiffAuthSession("https://api.example.com", "test-liff-id", "/me", signal),
    ).resolves.toMatchObject({ authenticated: true });

    expect(mocks.initializeLiffForAuthExchange).toHaveBeenCalledWith("test-liff-id");
    expect(mocks.exchangeLiffCredential).toHaveBeenCalledWith(
      "https://api.example.com",
      "secret.id.token",
      "/me",
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

    const first = establishLiffAuthSession(undefined, "test-liff-id", "/me", signal);
    const second = establishLiffAuthSession(undefined, "test-liff-id", "/me", signal);
    expect(mocks.initializeLiffForAuthExchange).toHaveBeenCalledTimes(1);
    finishInitialization?.({
      status: "ready",
      inClient: true,
    });

    await Promise.all([first, second]);
    expect(mocks.exchangeLiffCredential).toHaveBeenCalledTimes(2);
  });

  it("ログイン遷移中はcredentialを読まずfeature requestを止める", async () => {
    mocks.initializeLiffForAuthExchange.mockResolvedValue({ status: "login-required" });

    await expect(
      establishLiffAuthSession(undefined, "test-liff-id", "/me", new AbortController().signal),
    ).resolves.toEqual({ redirecting: true });
    expect(mocks.readCredential).not.toHaveBeenCalled();
    expect(mocks.exchangeLiffCredential).not.toHaveBeenCalled();
  });
});
