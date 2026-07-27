import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liff } from "./liff";

const CHANNEL_ID = "2010850319";
const CHANNEL_SECRET = "dummy-channel-secret";
const LIFF_ID = "2010850319-Yl63upAR";
const ENDPOINT = "https://stg.kagami.kyosuke.dev";
const DESCRIPTION = "me-builder-web (preview)";

type FetchCall = { url: string; method: string; body: string | undefined };

let calls: FetchCall[];

/** URL ごとの応答を差し替えられる fetch のモックを組み立てます。 */
function mockFetch(
  handlers: (url: string, method: string) => { status?: number; json?: unknown; text?: string },
): void {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : undefined;
    calls.push({ url: input, method, body });

    const result = handlers(input, method);
    const status = result.status ?? 200;
    const text = result.text ?? (result.json === undefined ? "" : JSON.stringify(result.json));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  });
}

const params = {
  channelId: CHANNEL_ID,
  channelSecret: CHANNEL_SECRET,
  liffId: LIFF_ID,
  endpointUrl: ENDPOINT,
  description: DESCRIPTION,
};

describe("line.liff.registerEndpoint", () => {
  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("設定が欠けている場合は API を呼ばずスキップすること", async () => {
    mockFetch(() => ({ json: {} }));

    const result = await liff.registerEndpoint({ ...params, channelSecret: undefined });

    expect(result.success).toBe(false);
    expect(result.message).toContain("スキップ");
    expect(calls).toHaveLength(0);
  });

  it("エンドポイント URL が未設定の場合もスキップすること", async () => {
    mockFetch(() => ({ json: {} }));

    const result = await liff.registerEndpoint({ ...params, endpointUrl: undefined });

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("LIFF ID が一致するアプリの URL を更新すること", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              {
                liffId: LIFF_ID,
                description: "old name",
                view: { type: "full", url: "https://old" },
              },
            ],
          },
        };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint(params);

    expect(result).toMatchObject({ success: true, liffId: LIFF_ID });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe(`https://api.line.me/liff/v1/apps/${LIFF_ID}`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      view: { type: "full", url: ENDPOINT },
      description: DESCRIPTION,
      scope: ["openid", "profile"],
    });
  });

  it("LIFF ID 未指定でも description が一致するアプリを更新すること", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              { liffId: "9999999999-other", description: "別のアプリ", view: { url: "https://x" } },
              { liffId: LIFF_ID, description: DESCRIPTION, view: { url: "https://old" } },
            ],
          },
        };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint({ ...params, liffId: undefined });

    expect(result).toMatchObject({ success: true, liffId: LIFF_ID });
    expect(calls.some((c) => c.method === "PUT" && c.url.endsWith(LIFF_ID))).toBe(true);
  });

  it("URL とビューが既に一致している場合は更新しないこと", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              {
                liffId: LIFF_ID,
                description: DESCRIPTION,
                view: { type: "full", url: ENDPOINT },
                scope: ["openid", "profile"],
              },
            ],
          },
        };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint(params);

    expect(result).toMatchObject({ success: true, liffId: LIFF_ID });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("該当するアプリが無ければ新規作成して LIFF ID を返すこと", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return { json: { apps: [] } };
      }
      return { json: { liffId: "2010850319-newapp1" } };
    });

    const result = await liff.registerEndpoint(params);

    expect(result).toMatchObject({ success: true, liffId: "2010850319-newapp1" });
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/apps"));
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      view: { type: "full", url: ENDPOINT },
      description: DESCRIPTION,
      // openid が無いと liff.getIDToken() が ID トークンを返さない
      scope: ["openid", "profile"],
    });
  });

  it("channelId 未指定なら LIFF ID の接頭辞をチャネル ID として使うこと", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              {
                liffId: LIFF_ID,
                view: { type: "full", url: ENDPOINT },
                scope: ["openid", "profile"],
              },
            ],
          },
        };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint({ ...params, channelId: undefined });

    expect(result.success).toBe(true);
    const tokenCall = calls.find((c) => c.url.includes("/oauth"));
    expect(tokenCall?.body).toContain(`client_id=${CHANNEL_ID}`);
  });

  it("ステートレストークンが失敗したら短命トークンのエンドポイントへフォールバックすること", async () => {
    mockFetch((url, method) => {
      if (url === "https://api.line.me/oauth2/v3/token") {
        return { status: 400, text: "unsupported_grant_type" };
      }
      if (url === "https://api.line.me/v2/oauth/accessToken") {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              {
                liffId: LIFF_ID,
                view: { type: "full", url: ENDPOINT },
                scope: ["openid", "profile"],
              },
            ],
          },
        };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint(params);

    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.url.includes("/oauth"))).toHaveLength(2);
  });

  it("トークン発行が全て失敗した場合は例外を投げず失敗を返すこと", async () => {
    mockFetch((url) => {
      if (url.includes("/oauth")) {
        return { status: 401, text: "invalid_client" };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint(params);

    expect(result.success).toBe(false);
    expect(result.message).toContain("失敗");
  });

  it("シークレットとトークンをメッセージへ含めないこと", async () => {
    mockFetch((url) => {
      if (url.includes("/oauth")) {
        return { status: 401, text: `invalid_client ${CHANNEL_SECRET}` };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint(params);

    expect(result.success).toBe(false);
    // API のレスポンス本文を転記する場合でも、こちらから送ったシークレットは出さない
    expect(result.message).not.toContain(CHANNEL_SECRET);
  });

  it("URL が一致していても openid が欠けていれば scope を付け直すこと", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              {
                liffId: LIFF_ID,
                description: DESCRIPTION,
                view: { type: "full", url: ENDPOINT },
                scope: ["profile"],
              },
            ],
          },
        };
      }
      return { json: {} };
    });

    const result = await liff.registerEndpoint(params);

    expect(result.success).toBe(true);
    const put = calls.find((c) => c.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}").scope).toEqual(["openid", "profile"]);
  });

  it("一覧が scope を返さない場合は判定できないので更新すること", async () => {
    mockFetch((url, method) => {
      if (url.includes("/oauth")) {
        return { json: { access_token: "dummy-token" } };
      }
      if (method === "GET") {
        return {
          json: {
            apps: [
              { liffId: LIFF_ID, description: DESCRIPTION, view: { type: "full", url: ENDPOINT } },
            ],
          },
        };
      }
      return { json: {} };
    });

    await liff.registerEndpoint(params);

    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });
});
