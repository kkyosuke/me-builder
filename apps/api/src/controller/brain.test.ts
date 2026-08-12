import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { DevelopmentBrainItemsOutcome } from "../logic/development-brain-items";

const { loadDevelopmentBrainItems, loadDevelopmentBrainVector } = vi.hoisted(() => ({
  loadDevelopmentBrainItems: vi.fn(),
  loadDevelopmentBrainVector: vi.fn(),
}));
vi.mock("../logic/development-brain-items", () => ({
  getDevelopmentBrainItems: loadDevelopmentBrainItems,
  getDevelopmentBrainVector: loadDevelopmentBrainVector,
}));

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const dummyVectorIndex = {} as ApiBindings["BRAIN_VECTOR_INDEX"];
const outcome = (value: DevelopmentBrainItemsOutcome) =>
  loadDevelopmentBrainItems.mockResolvedValue(value);

function request(environment = "development", withBindings = true) {
  return app.request(
    "/api/dev/brain-items",
    { headers: { Authorization: "Bearer dummy.id.token" } },
    {
      ENVIRONMENT: environment,
      LIFF_ID: "2010850319-Yl63upAR",
      ...(withBindings
        ? {
            DB: dummyDb,
            ACCOUNT_DATA: dummyAccountData,
            BRAIN_VECTOR_INDEX: dummyVectorIndex,
          }
        : {}),
    },
  );
}

describe("GET /api/dev/brain-items", () => {
  beforeEach(() => vi.clearAllMocks());

  it("active ItemとEvidenceをISO日時で返す", async () => {
    outcome({
      type: "resolved",
      items: [
        {
          id: "brain-1",
          category: "memory",
          statement: "公園を散歩した",
          derivation: "ai",
          status: "active",
          createdAt: new Date("2026-08-09T00:00:00Z"),
          firstObservedAt: new Date("2026-08-01T00:00:00Z"),
          lastObservedAt: new Date("2026-08-09T00:00:00Z"),
          vectorSync: {
            status: "applied",
            operation: "upsert",
            attemptCount: 1,
            updatedAt: new Date("2026-08-09T00:01:00Z"),
            hasEntry: true,
            entryRevision: 1,
          },
          evidence: [
            {
              sourceRecordId: "source-1",
              relation: "supports",
              derivationMethod: "ai",
              generatedAt: new Date("2026-08-09T00:00:01Z"),
              recordedAt: new Date("2026-08-09T00:00:00Z"),
            },
          ],
        },
      ],
      truncated: false,
    });

    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "brain-1",
          createdAt: "2026-08-09T00:00:00.000Z",
          firstObservedAt: "2026-08-01T00:00:00.000Z",
          lastObservedAt: "2026-08-09T00:00:00.000Z",
          evidence: [
            expect.objectContaining({
              generatedAt: "2026-08-09T00:00:01.000Z",
              recordedAt: "2026-08-09T00:00:00.000Z",
            }),
          ],
        }),
      ],
      truncated: false,
    });
  });

  it("productionでは存在を公開せず404を返す", async () => {
    const response = await request("production");
    expect(response.status).toBe(404);
    expect(loadDevelopmentBrainItems).not.toHaveBeenCalled();
  });

  it("ENVIRONMENT未設定では存在を公開せず404を返す", async () => {
    const response = await app.request(
      "/api/dev/brain-items",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID: "2010850319-Yl63upAR", DB: dummyDb, ACCOUNT_DATA: dummyAccountData },
    );

    expect(response.status).toBe(404);
    expect(loadDevelopmentBrainItems).not.toHaveBeenCalled();
  });

  it("storage bindingがなければ503を返す", async () => {
    const response = await request("development", false);
    expect(response.status).toBe(503);
    expect(loadDevelopmentBrainItems).not.toHaveBeenCalled();
  });

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid" },
  ])("$typeを401へ変換する", async (value) => {
    outcome(value);
    expect((await request()).status).toBe(401);
  });
});

describe("GET /api/dev/brain-items/:brainItemId/vector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Vectorize実体の確認結果を返す", async () => {
    loadDevelopmentBrainVector.mockResolvedValue({
      type: "resolved",
      result: {
        state: "present",
        entryRevision: 12,
        dimensions: 768,
        metadata: { category: "memory", derivation: "ai", embeddingVersion: 1, schemaVersion: 1 },
        checkedAt: new Date("2026-08-10T00:00:00Z"),
      },
    });

    const response = await app.request(
      "/api/dev/brain-items/brain-1/vector",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      {
        ENVIRONMENT: "development",
        LIFF_ID: "2010850319-Yl63upAR",
        DB: dummyDb,
        ACCOUNT_DATA: dummyAccountData,
        BRAIN_VECTOR_INDEX: dummyVectorIndex,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      state: "present",
      entryRevision: 12,
      dimensions: 768,
      metadata: { category: "memory", derivation: "ai", embeddingVersion: 1, schemaVersion: 1 },
      checkedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(loadDevelopmentBrainVector).toHaveBeenCalledWith(
      expect.objectContaining({ brainItemId: "brain-1", vectorIndex: dummyVectorIndex }),
    );
  });

  it("productionではVectorize bindingがなくても404を返す", async () => {
    const response = await app.request(
      "/api/dev/brain-items/brain-1/vector",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { ENVIRONMENT: "production" },
    );

    expect(response.status).toBe(404);
    expect(loadDevelopmentBrainVector).not.toHaveBeenCalled();
  });

  it("ENVIRONMENT未設定ではVectorize bindingがあっても404を返す", async () => {
    const response = await app.request(
      "/api/dev/brain-items/brain-1/vector",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      {
        LIFF_ID: "2010850319-Yl63upAR",
        DB: dummyDb,
        ACCOUNT_DATA: dummyAccountData,
        BRAIN_VECTOR_INDEX: dummyVectorIndex,
      },
    );

    expect(response.status).toBe(404);
    expect(loadDevelopmentBrainVector).not.toHaveBeenCalled();
  });
});
