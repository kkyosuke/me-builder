import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeLiff, verifyLiffSession } from "./index";

const mockLiff = vi.hoisted(() => ({
  init: vi.fn(),
  isInClient: vi.fn(),
  isLoggedIn: vi.fn(),
  login: vi.fn(),
  getProfile: vi.fn(),
  getIDToken: vi.fn(),
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

describe("verifyLiffSession", () => {
  const API_URL = "https://api.stg.kagami.kyosuke.dev";
  let calls: { url: string; body: string | undefined }[];

  beforeEach(() => {
    calls = [];
    vi.clearAllMocks();
    mockLiff.getIDToken.mockReturnValue("dummy.id.token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockFetch = (status: number) => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      return { ok: status >= 200 && status < 300, status };
    });
  };

  it("検証に成功すれば verified を返し、ID トークンを API へ送ること", async () => {
    mockFetch(200);

    const state = await verifyLiffSession(API_URL);

    expect(state).toEqual({ status: "verified" });
    expect(calls[0]?.url).toBe(`${API_URL}/api/line/liff/session`);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ idToken: "dummy.id.token" });
  });

  it("Account が無い (404) 場合は friendship-required を返すこと", async () => {
    mockFetch(404);

    expect(await verifyLiffSession(API_URL)).toEqual({ status: "friendship-required" });
  });

  it("検証が拒否された (401) 場合は error を返すこと", async () => {
    mockFetch(401);

    expect(await verifyLiffSession(API_URL)).toMatchObject({ status: "error" });
  });

  it("ID トークンが取得できなければ API を呼ばずに error を返すこと", async () => {
    mockFetch(200);
    mockLiff.getIDToken.mockReturnValue(null);

    expect(await verifyLiffSession(API_URL)).toMatchObject({ status: "error" });
    expect(calls).toHaveLength(0);
  });

  it("通信に失敗しても例外を投げず error を返すこと", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    expect(await verifyLiffSession(API_URL)).toMatchObject({ status: "error" });
  });
});
