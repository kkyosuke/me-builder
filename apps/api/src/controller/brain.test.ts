import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { DevelopmentBrainItemsOutcome } from "../logic/development-brain-items";

const { loadDevelopmentBrainItems } = vi.hoisted(() => ({
  loadDevelopmentBrainItems: vi.fn(),
}));
vi.mock("../logic/development-brain-items", () => ({
  getDevelopmentBrainItems: loadDevelopmentBrainItems,
}));

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const outcome = (value: DevelopmentBrainItemsOutcome) =>
  loadDevelopmentBrainItems.mockResolvedValue(value);

function request(environment = "development", withBindings = true) {
  return app.request(
    "/api/dev/brain-items",
    { headers: { Authorization: "Bearer dummy.id.token" } },
    {
      ENVIRONMENT: environment,
      LIFF_ID: "2010850319-Yl63upAR",
      ...(withBindings ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}),
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
          evidence: [
            {
              sourceRecordId: "source-1",
              relation: "supports",
              derivationMethod: "ai",
              generatedAt: new Date("2026-08-09T00:00:01Z"),
            },
          ],
        },
      ],
      truncated: false,
    });

    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "brain-1",
          createdAt: "2026-08-09T00:00:00.000Z",
          evidence: [expect.objectContaining({ generatedAt: "2026-08-09T00:00:01.000Z" })],
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
