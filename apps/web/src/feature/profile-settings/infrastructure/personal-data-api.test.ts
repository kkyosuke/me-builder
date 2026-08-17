import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correctPersonalDataRecord,
  deletePersonalDataRecord,
  downloadPersonalDataExport,
  fetchPersonalDataExport,
  fetchPersonalDataRecords,
  requestPersonalDataExport,
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

  it("本人データexportの作成・状態確認・downloadを認証付きで行う", async () => {
    const exportBody = {
      export: {
        id: "export-1",
        status: "ready",
        requestedAt: "2026-08-15T00:00:00.000Z",
        completedAt: "2026-08-15T00:00:01.000Z",
        expiresAt: "2026-08-16T00:00:01.000Z",
        downloadUrl: "/api/personal-data/exports/export-1/download",
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...exportBody, outcome: "created" })))
      .mockResolvedValueOnce(new Response(JSON.stringify(exportBody)))
      .mockResolvedValueOnce(
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(requestPersonalDataExport("")).resolves.toMatchObject({
      id: "export-1",
      status: "ready",
    });
    await expect(fetchPersonalDataExport("", "export-1")).resolves.toMatchObject({
      id: "export-1",
    });
    await expect(downloadPersonalDataExport("", "export-1")).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/personal-data/exports/export-1/download",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
