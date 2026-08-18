import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace } from "@me-builder/lib";
import type { ProfileSummaryGenerationQueueMessage, Queue } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { ProfileSummaryOutcome } from "../logic/profile-summary";

const { getProfileSummary } = vi.hoisted(() => ({ getProfileSummary: vi.fn() }));
const { requestProfileSummaryGeneration } = vi.hoisted(() => ({
  requestProfileSummaryGeneration: vi.fn(),
}));
vi.mock("../logic/profile-summary", () => ({ getProfileSummary }));
vi.mock("../logic/profile-summary-generation", () => ({ requestProfileSummaryGeneration }));
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
      c.set("authenticationResult", {
        type: "authenticated",
        actor,
        accountRole: "user",
      });
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

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const dummyQueue = {} as Queue<ProfileSummaryGenerationQueueMessage>;
const outcome = (value: ProfileSummaryOutcome) => getProfileSummary.mockResolvedValue(value);

function request(withDb = true, environment?: string) {
  return app.request(
    "/api/profile-summary",
    {},
    {
      LIFF_ID: "2010850319-Yl63upAR",
      ...(environment ? { ENVIRONMENT: environment } : {}),
      ...(withDb ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData } : {}),
    },
  );
}

function generationRequest(withBindings = true, environment?: string) {
  return app.request(
    "/api/profile-summary/generations",
    { method: "POST" },
    {
      LIFF_ID: "2010850319-Yl63upAR",
      ...(environment ? { ENVIRONMENT: environment } : {}),
      ...(withBindings
        ? { DB: dummyDb, ACCOUNT_DATA: dummyAccountData, PROFILE_SUMMARY_QUEUE: dummyQueue }
        : {}),
    },
  );
}

describe("GET /api/profile-summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("生成済みのまとめと次の行動を返す", async () => {
    outcome({
      type: "resolved",
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
      diagnosisThemes: [],
      nextAction: "diagnosis",
    });

    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
      diagnosisThemes: [],
      nextAction: "diagnosis",
    });
    expect(getProfileSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ accountId: "account-1" }),
      }),
    );
  });

  it("DB bindingがなければ503を返す", async () => {
    const response = await request(false);
    expect(response.status).toBe(503);
    expect(getProfileSummary).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile-summary/generations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("生成要求を202で返す", async () => {
    requestProfileSummaryGeneration.mockResolvedValue({
      type: "accepted",
      generationId: "generation-1",
      status: "queued",
      created: true,
    });

    const response = await generationRequest();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      generationId: "generation-1",
      status: "queued",
      created: true,
    });
    expect(requestProfileSummaryGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ accountId: "account-1" }) }),
    );
  });

  it("利用できる記録がなければ409を返す", async () => {
    requestProfileSummaryGeneration.mockResolvedValue({
      type: "unavailable",
      reason: "source_record_required",
    });

    const response = await generationRequest();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "source_record_required" });
  });

  it("再生成理由がなければ409を返す", async () => {
    requestProfileSummaryGeneration.mockResolvedValue({
      type: "unavailable",
      reason: "regeneration_not_required",
    });

    const response = await generationRequest();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "regeneration_not_required" });
  });

  it("Queue bindingがなければ503を返す", async () => {
    const response = await generationRequest(false);
    expect(response.status).toBe(503);
    expect(requestProfileSummaryGeneration).not.toHaveBeenCalled();
  });
});
