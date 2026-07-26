import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idToken } from "./id-token";

const CHANNEL_ID = "2010850319";
const ID_TOKEN = "dummy.id.token";
const SUB = "U0000000000000000000000000000000";

let calls: { url: string; body: string | undefined }[];

function mockFetch(response: { status?: number; json: unknown }): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: init?.body instanceof URLSearchParams ? init.body.toString() : undefined,
    });
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response.json,
    };
  });
}

describe("line.idToken.verify", () => {
  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("検証に成功すれば sub と表示用のクレームを返すこと", async () => {
    mockFetch({
      json: {
        iss: "https://access.line.me",
        sub: SUB,
        aud: CHANNEL_ID,
        exp: 1785000000,
        name: "うつし",
        picture: "https://example.com/picture.jpg",
      },
    });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result).toEqual({
      ok: true,
      claims: { sub: SUB, name: "うつし", picture: "https://example.com/picture.jpg" },
    });
    expect(calls[0]?.url).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(calls[0]?.body).toContain(`client_id=${CHANNEL_ID}`);
  });

  it("aud が LINE Login チャネル ID と一致しなければ拒否すること", async () => {
    mockFetch({ json: { sub: SUB, aud: "9999999999" } });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result).toEqual({ ok: false, reason: "aud が一致しません" });
  });

  it("検証エンドポイントがエラーを返せば拒否すること（期限切れ・改ざんを含む）", async () => {
    mockFetch({ status: 400, json: { error: "invalid_request" } });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
  });

  it("sub が無ければ拒否すること", async () => {
    mockFetch({ json: { aud: CHANNEL_ID } });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result).toMatchObject({ ok: false });
  });

  it("id_token またはチャネル ID が無ければ API を呼ばずに拒否すること", async () => {
    mockFetch({ json: {} });

    expect(await idToken.verify({ idToken: "", channelId: CHANNEL_ID })).toMatchObject({
      ok: false,
    });
    expect(await idToken.verify({ idToken: ID_TOKEN, channelId: "" })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("ネットワークエラーでも例外を投げず拒否を返すこと", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result).toMatchObject({ ok: false });
  });

  it("拒否の理由に ID トークンそのものを含めないこと", async () => {
    mockFetch({ status: 400, json: { error: "invalid_request", error_description: ID_TOKEN } });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain(ID_TOKEN);
    }
  });
});

describe("line.idToken.resolveLoginChannelId", () => {
  it("チャネル ID が指定されていればそれを使うこと", () => {
    expect(idToken.resolveLoginChannelId({ channelId: "111", liffId: "222-abc" })).toBe("111");
  });

  it("未指定なら LIFF ID の接頭辞から補完すること", () => {
    expect(idToken.resolveLoginChannelId({ liffId: `${CHANNEL_ID}-Yl63upAR` })).toBe(CHANNEL_ID);
  });

  it("接頭辞が数値でなければ補完しないこと", () => {
    expect(idToken.resolveLoginChannelId({ liffId: "abc-def" })).toBeUndefined();
    expect(idToken.resolveLoginChannelId({})).toBeUndefined();
  });
});
