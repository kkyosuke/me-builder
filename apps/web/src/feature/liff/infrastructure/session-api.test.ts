import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLiffSession } from "./session-api";

const mocks = vi.hoisted(() => ({ getLiffIdToken: vi.fn() }));

vi.mock("./liff-client", () => ({ getLiffIdToken: mocks.getLiffIdToken }));

const API_URL = "https://api.stg.kagami.kyosuke.dev";

describe("verifyLiffSession", () => {
  let calls: { url: string; body: string | undefined }[];

  beforeEach(() => {
    calls = [];
    vi.clearAllMocks();
    mocks.getLiffIdToken.mockReturnValue("dummy.id.token");
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

  it("検証に成功すればverifiedを返し、IDトークンをAPIへ送る", async () => {
    mockFetch(200);

    const state = await verifyLiffSession(API_URL);

    expect(state).toEqual({ status: "verified" });
    expect(calls[0]?.url).toBe(`${API_URL}/api/line/liff/session`);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ idToken: "dummy.id.token" });
  });

  it("Accountが無い場合はfriendship-requiredを返す", async () => {
    mockFetch(404);

    expect(await verifyLiffSession(API_URL)).toEqual({ status: "friendship-required" });
  });

  it("検証が拒否された場合はerrorを返す", async () => {
    mockFetch(401);

    expect(await verifyLiffSession(API_URL)).toMatchObject({ status: "error" });
  });

  it("IDトークンを取得できなければAPIを呼ばずにerrorを返す", async () => {
    mockFetch(200);
    mocks.getLiffIdToken.mockReturnValue(null);

    expect(await verifyLiffSession(API_URL)).toMatchObject({ status: "error" });
    expect(calls).toHaveLength(0);
  });

  it("通信に失敗しても例外を投げずerrorを返す", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    expect(await verifyLiffSession(API_URL)).toMatchObject({ status: "error" });
  });
});
