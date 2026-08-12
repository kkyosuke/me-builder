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

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const dummyQueue = {} as Queue<ProfileSummaryGenerationQueueMessage>;
const outcome = (value: ProfileSummaryOutcome) => getProfileSummary.mockResolvedValue(value);

function request(withDb = true, environment?: string) {
  return app.request(
    "/api/profile-summary",
    { headers: { Authorization: "Bearer dummy.id.token" } },
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
    { method: "POST", headers: { Authorization: "Bearer dummy.id.token" } },
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
        idToken: "dummy.id.token",
        lineLoginChannelId: "2010850319",
        allowUnchangedRegeneration: true,
      }),
    );
  });

  it("productionでは無変更再生成を許可しない", async () => {
    outcome({
      type: "resolved",
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
      diagnosisThemes: [],
      nextAction: "chat",
    });

    await request(true, "production");

    expect(getProfileSummary).toHaveBeenCalledWith(
      expect.objectContaining({ allowUnchangedRegeneration: false }),
    );
  });

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid" },
  ])("$typeを401へ変換する", async (value) => {
    outcome(value);
    const response = await request();
    expect(response.status).toBe(401);
  });

  it("Accountがなければ友だち追加を案内する404を返す", async () => {
    outcome({ type: "account-not-found" });
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
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
      expect.objectContaining({ allowUnchangedRegeneration: true }),
    );
  });

  it("productionでは無変更再生成を許可しない", async () => {
    requestProfileSummaryGeneration.mockResolvedValue({
      type: "unavailable",
      reason: "regeneration_not_required",
    });

    await generationRequest(true, "production");

    expect(requestProfileSummaryGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ allowUnchangedRegeneration: false }),
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
