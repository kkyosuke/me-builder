import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const mocks = vi.hoisted(() => ({
  listPersonalData: vi.fn(),
  getPersonalDataFeatures: vi.fn(),
  correctPersonalData: vi.fn(),
  deletePersonalData: vi.fn(),
}));
vi.mock("../logic/personal-data", () => mocks);
vi.mock("../middleware/authentication", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authentication")>();
  return {
    ...actual,
    requireAuthentication: async (
      c: Parameters<typeof actual.requireAuthentication>[0],
      next: () => Promise<void>,
    ) => {
      const actor = {
        accountId: "account-1",
        authenticationMethod: "liff" as const,
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      };
      c.set("authenticatedActor", actor);
      await next();
    },
  };
});
vi.mock("../middleware/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authorization")>();
  return {
    ...actual,
    requireCurrentTerms: async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

const bindings = {
  LIFF_ID: "2010850319-Yl63upAR",
  DB: {} as D1Database,
  ACCOUNT_DATA: {} as AccountDataNamespace,
};
const headers = {};

describe("personal data controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("現在有効な診断回答と日記だけを返す", async () => {
    mocks.listPersonalData.mockResolvedValue({
      type: "resolved",
      records: [
        {
          id: "source-1",
          kind: "diary",
          title: "日記",
          value: "今日の記録",
          recordedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });

    const response = await app.request("/api/personal-data/records", { headers }, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ records: [{ id: "source-1" }] });
  });

  it("本文と識別子を含まないBrain特徴だけをAPIで返す", async () => {
    mocks.getPersonalDataFeatures.mockResolvedValue({
      type: "resolved",
      features: {
        format: "kagami-brain-features",
        formatVersion: 1,
        generatedAt: "2026-08-16T00:00:00.000Z",
        scopes: ["attributes", "active", "history"],
        brainItems: [
          {
            category: "preference",
            attributes: { timePreference: "morning" },
            status: "active",
            derivation: "ai",
            stability: "changeable",
            sensitivity: "normal",
            validFrom: null,
            validTo: null,
            firstObservedAt: "2026-08-15T00:00:00.000Z",
            lastObservedAt: "2026-08-15T00:00:00.000Z",
            createdAt: "2026-08-15T00:00:00.000Z",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
        ],
      },
    });

    const response = await app.request("/api/personal-data/features", { headers }, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      scopes: ["attributes", "active", "history"],
      brainItems: [{ attributes: { timePreference: "morning" } }],
    });
    expect(JSON.stringify(body)).not.toMatch(/statement|sourceRecord|evidence|accountId/i);
  });

  it("日記訂正を本人のSource Record IDへだけ適用する", async () => {
    mocks.correctPersonalData.mockResolvedValue({
      type: "resolved",
      result: {
        type: "updated",
        recordId: "source-2",
        invalidatedBrainItemCount: 2,
      },
    });

    const response = await app.request(
      "/api/personal-data/records/source-1",
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "diary", value: "訂正後" }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "updated",
      recordId: "source-2",
      invalidatedBrainItemCount: 2,
    });
    expect(mocks.correctPersonalData).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRecordId: "source-1",
        input: { kind: "diary", value: "訂正後" },
        actor: expect.objectContaining({ accountId: "account-1" }),
      }),
    );
  });

  it("削除済みまたは他Accountの原本を404へ変換する", async () => {
    mocks.deletePersonalData.mockResolvedValue({
      type: "resolved",
      result: { type: "not-found" },
    });

    const response = await app.request(
      "/api/personal-data/records/unknown",
      { method: "DELETE", headers },
      bindings,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Personal data record not found" });
  });

  it("bindingがなければ操作せず503を返す", async () => {
    const response = await app.request(
      "/api/personal-data/records",
      { headers },
      { LIFF_ID: bindings.LIFF_ID },
    );
    expect(response.status).toBe(503);
    expect(mocks.listPersonalData).not.toHaveBeenCalled();
  });
});
