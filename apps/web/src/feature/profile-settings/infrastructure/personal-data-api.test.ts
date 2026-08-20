import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correctPersonalDataRecord,
  deletePersonalDataRecord,
  fetchPersonalDataFeatures,
  fetchPersonalDataRecords,
} from "./personal-data-api";

describe("personal data api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("本人の入力一覧を検証して返す", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          records: [
            {
              id: "source-1",
              kind: "diary",
              title: "日記",
              value: "今日の記録",
              recordedAt: "2026-08-15T00:00:00.000Z",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchPersonalDataRecords("https://api.example.com")).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/personal-data/records",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("本文と識別子を含まないBrain特徴を検証して返す", async () => {
    const features = {
      format: "kagami-brain-features",
      formatVersion: 1,
      generatedAt: "2026-08-21T00:00:00.000Z",
      scopes: ["metadata", "active", "history"],
      brainItems: [],
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(features)));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchPersonalDataFeatures("https://api.example.com")).resolves.toEqual(features);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/personal-data/features",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("訂正bodyと削除methodをSource Recordへ送る", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          outcome: "updated",
          recordId: "source-2",
          invalidatedBrainItemCount: 1,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await correctPersonalDataRecord("", "source/1", { kind: "diary", value: "訂正後" });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/personal-data/records/source%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ kind: "diary", value: "訂正後" }),
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ outcome: "deleted", recordId: "source-1", invalidatedBrainItemCount: 1 }),
      ),
    );
    await deletePersonalDataRecord("", "source-1");
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/personal-data/records/source-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("本人の原本がなければ再読込を促す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(deletePersonalDataRecord("", "missing")).rejects.toThrow("すでに削除または訂正");
  });
});
