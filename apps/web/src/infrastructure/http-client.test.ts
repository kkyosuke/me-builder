import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./http-client";

describe("createHttpClient", () => {
  it("ベースURLとパスを結合してfetchへ委譲する", async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createHttpClient("https://api.example.com///", fetchImplementation);
    const init = { headers: { Authorization: "Bearer token" } };

    const response = await client.request("api/diagnoses", init);

    expect(fetchImplementation).toHaveBeenCalledWith("https://api.example.com/api/diagnoses", init);
    expect(response.status).toBe(204);
  });

  it("ベースURLが未設定なら同一オリジンの絶対パスを使う", async () => {
    const fetchImplementation = vi.fn(async () => new Response());
    const client = createHttpClient(undefined, fetchImplementation);

    await client.request("/api/diagnoses");

    expect(fetchImplementation).toHaveBeenCalledWith("/api/diagnoses", undefined);
  });

  it("パス先頭のスラッシュを1つに正規化する", async () => {
    const fetchImplementation = vi.fn(async () => new Response());
    const client = createHttpClient("https://api.example.com", fetchImplementation);

    await client.request("///api/diagnoses");

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.example.com/api/diagnoses",
      undefined,
    );
  });
});
