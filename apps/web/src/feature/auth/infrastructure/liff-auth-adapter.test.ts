import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeLiff: vi.fn(),
  readCredential: vi.fn(),
  exchangeLiffCredential: vi.fn(),
}));

vi.mock("../../liff/infrastructure/liff-client", () => ({
  initializeLiff: mocks.initializeLiff,
  readLiffAuthExchangeCredential: mocks.readCredential,
}));
vi.mock("./auth-session-api", () => ({
  exchangeLiffCredential: mocks.exchangeLiffCredential,
}));

import { establishLiffAuthSession } from "./liff-auth-adapter";

describe("establishLiffAuthSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initializeLiff.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
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

    expect(mocks.initializeLiff).toHaveBeenCalledWith("test-liff-id");
    expect(mocks.exchangeLiffCredential).toHaveBeenCalledWith(
      "https://api.example.com",
      "secret.id.token",
      "/me",
      signal,
    );
  });

  it("同時の交換要求ではLIFF初期化だけを共有する", async () => {
    let finishInitialization: ((state: unknown) => void) | undefined;
    mocks.initializeLiff.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInitialization = resolve;
        }),
    );
    const signal = new AbortController().signal;

    const first = establishLiffAuthSession(undefined, "test-liff-id", "/me", signal);
    const second = establishLiffAuthSession(undefined, "test-liff-id", "/me", signal);
    expect(mocks.initializeLiff).toHaveBeenCalledTimes(1);
    finishInitialization?.({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });

    await Promise.all([first, second]);
    expect(mocks.exchangeLiffCredential).toHaveBeenCalledTimes(2);
  });

  it("ログイン遷移中はcredentialを読まずfeature requestを止める", async () => {
    mocks.initializeLiff.mockResolvedValue({ status: "login-required" });

    await expect(
      establishLiffAuthSession(undefined, "test-liff-id", "/me", new AbortController().signal),
    ).resolves.toEqual({ redirecting: true });
    expect(mocks.readCredential).not.toHaveBeenCalled();
    expect(mocks.exchangeLiffCredential).not.toHaveBeenCalled();
  });
});
