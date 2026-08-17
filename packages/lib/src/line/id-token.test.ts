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
    const issuedAt = Math.floor(Date.now() / 1_000) - 60;
    mockFetch({
      json: {
        iss: "https://access.line.me",
        sub: SUB,
        aud: CHANNEL_ID,
        exp: 1785000000,
        iat: issuedAt,
        name: "うつし",
        picture: "https://example.com/picture.jpg",
      },
    });

    const result = await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID });

    expect(result).toEqual({
      ok: true,
      claims: {
        sub: SUB,
        issuedAt: new Date(issuedAt * 1_000),
        name: "うつし",
        picture: "https://example.com/picture.jpg",
      },
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

describe("line.idToken.verify の経過時間チェック", () => {
  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** `iat` を「今から n 秒前」に置いたクレームを作ります。 */
  const claimsIssuedAgo = (seconds: number) => ({
    iss: "https://access.line.me",
    sub: SUB,
    aud: CHANNEL_ID,
    iat: Math.floor(Date.now() / 1000) - seconds,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  it("maxAgeSeconds を超えて古い ID トークンを拒否すること", async () => {
    mockFetch({ json: claimsIssuedAgo(600) });

    const result = await idToken.verify({
      idToken: ID_TOKEN,
      channelId: CHANNEL_ID,
      maxAgeSeconds: 300,
    });

    expect(result).toMatchObject({ ok: false, reason: "ID トークンが古すぎます" });
  });

  it("maxAgeSeconds の範囲内なら受け入れること", async () => {
    const claims = claimsIssuedAgo(60);
    mockFetch({ json: claims });

    const result = await idToken.verify({
      idToken: ID_TOKEN,
      channelId: CHANNEL_ID,
      maxAgeSeconds: 300,
    });

    expect(result).toMatchObject({
      ok: true,
      claims: { issuedAt: new Date(claims.iat * 1_000) },
    });
  });

  it("iat が数値でなければ認証時刻として受け入れないこと", async () => {
    mockFetch({
      json: { iss: "https://access.line.me", sub: SUB, aud: CHANNEL_ID, iat: "invalid" },
    });

    expect(await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID })).toEqual({
      ok: false,
      reason: "iat が不正です",
    });
  });

  it("既定では LINE の有効期間 (1 時間) と同じ扱いにすること", async () => {
    // 既定より厳しくしないので、59 分前のトークンは既定では通る
    mockFetch({ json: claimsIssuedAgo(59 * 60) });

    expect((await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID })).ok).toBe(true);

    mockFetch({ json: claimsIssuedAgo(61 * 60) });

    expect((await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID })).ok).toBe(false);
  });

  it("iat が無いレスポンスは認証時刻を補完せず拒否すること", async () => {
    mockFetch({ json: { iss: "https://access.line.me", sub: SUB, aud: CHANNEL_ID } });

    expect(await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID })).toEqual({
      ok: false,
      reason: "iat が不正です",
    });
  });

  it("許容幅を超える未来のiatを拒否すること", async () => {
    mockFetch({ json: claimsIssuedAgo(-61) });

    expect(await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID })).toEqual({
      ok: false,
      reason: "iat が不正です",
    });
  });

  it("許容するclock skewでも認証時刻を未来にしないこと", async () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    mockFetch({ json: claimsIssuedAgo(-30) });

    expect(await idToken.verify({ idToken: ID_TOKEN, channelId: CHANNEL_ID })).toMatchObject({
      ok: true,
      claims: { issuedAt: new Date(nowSeconds * 1_000) },
    });
  });
});
