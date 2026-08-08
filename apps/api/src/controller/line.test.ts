import type { D1Database } from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { LiffSessionOutcome } from "../logic/liff-session";

const { createLiffSession } = vi.hoisted(() => ({ createLiffSession: vi.fn() }));

// controller の責務は「リクエストの解釈」と「ドメインの結果 → HTTP への変換」だけなので、
// logic はモックし、変換が正しいかだけを見る。
vi.mock("../logic/liff-session", () => ({ createLiffSession }));

const dummyDb = {} as unknown as D1Database;
const LIFF_ID = "2010850319-Yl63upAR";

function request(body: string, env: Record<string, unknown> = {}) {
  return app.request(
    "/api/line/liff/session",
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    { LIFF_ID, DB: dummyDb, ...env },
  );
}

const outcome = (value: LiffSessionOutcome) => createLiffSession.mockResolvedValue(value);

describe("POST /api/line/liff/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolved を 200 とセッション情報へ変換すること", async () => {
    outcome({
      type: "resolved",
      session: {
        accountId: "acc-1",
        role: "user",
        displayName: "うつし",
        pictureUrl: "https://example.com/p.jpg",
      },
    });

    const res = await request(JSON.stringify({ idToken: "dummy.id.token" }));

    expect(res.status).toBe(200);
    // accountId はクライアントへ返さない (セッション管理の方式が未決定のため)
    expect(await res.json()).toEqual({
      displayName: "うつし",
      pictureUrl: "https://example.com/p.jpg",
    });
  });

  it("account-not-found を 404 と friendship_required へ変換すること", async () => {
    outcome({ type: "account-not-found" });

    const res = await request(JSON.stringify({ idToken: "dummy.id.token" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "friendship_required" });
  });

  it("unauthenticated を 401 へ変換し、理由をクライアントへ返さないこと", async () => {
    outcome({ type: "unauthenticated", reason: "aud が一致しません" });

    const res = await request(JSON.stringify({ idToken: "dummy.id.token" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("not-configured も 401 へ落とし、設定状態を推測させないこと", async () => {
    outcome({ type: "not-configured" });

    const res = await request(JSON.stringify({ idToken: "dummy.id.token" }));

    expect(res.status).toBe(401);
    // unauthenticated と同じ応答にする
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("DB バインディングが無い場合は logic を呼ばず 503 を返すこと", async () => {
    outcome({ type: "resolved", session: { accountId: "acc-1", role: "user" } });

    const res = await app.request(
      "/api/line/liff/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: "dummy.id.token" }),
      },
      { LIFF_ID },
    );

    expect(res.status).toBe(503);
    expect(createLiffSession).not.toHaveBeenCalled();
  });

  it("JSON でないボディでも 500 にせず、ID トークン無しとして logic へ渡すこと", async () => {
    outcome({ type: "unauthenticated", reason: "id_token がありません" });

    const res = await request("not-json");

    expect(res.status).toBe(401);
    expect(createLiffSession).toHaveBeenCalledWith(expect.objectContaining({ idToken: undefined }));
  });

  it("idToken が文字列でない場合も undefined として扱うこと", async () => {
    outcome({ type: "unauthenticated", reason: "id_token がありません" });

    await request(JSON.stringify({ idToken: { nested: "object" } }));

    expect(createLiffSession).toHaveBeenCalledWith(expect.objectContaining({ idToken: undefined }));
  });
});
