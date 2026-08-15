import type { D1Database } from "@cloudflare/workers-types";
import { currentServiceTerms } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { acceptServiceTerms, getServiceTermsStatus } from "../logic/service-terms";

vi.mock("../logic/service-terms", () => ({
  getServiceTermsStatus: vi.fn(),
  acceptServiceTerms: vi.fn(),
}));

const db = {} as D1Database;
const document = currentServiceTerms;

describe("service terms controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("現在の規約と未同意状態を返す", async () => {
    vi.mocked(getServiceTermsStatus).mockResolvedValue({
      type: "resolved",
      document,
      acceptance: {
        required: true,
        acceptedVersion: null,
        documentHash: null,
        acceptedAt: null,
      },
    });
    const response = await app.request(
      "/api/legal/terms",
      { headers: { Authorization: "Bearer token" } },
      { DB: db, LIFF_ID: "2010850319-Yl63upAR" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      document: { version: currentServiceTerms.version },
      acceptance: { required: true, acceptedVersion: null, documentHash: null, acceptedAt: null },
    });
  });

  it("現在versionへの同意を保存して返す", async () => {
    vi.mocked(acceptServiceTerms).mockResolvedValue({
      type: "accepted",
      acceptance: {
        id: "acceptance-1",
        accountId: "account-1",
        documentKey: "terms_of_service",
        documentVersion: currentServiceTerms.version,
        documentHash: currentServiceTerms.contentHash,
        acceptedAt: "2026-08-15T01:23:45.000Z",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        isDeleted: false,
      },
    });
    const response = await app.request(
      "/api/legal/terms/acceptance",
      {
        method: "PUT",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({ version: currentServiceTerms.version }),
      },
      { DB: db, LIFF_ID: "2010850319-Yl63upAR" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documentKey: "terms_of_service",
      version: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
      acceptedAt: "2026-08-15T01:23:45.000Z",
    });
  });

  it("古いversionへの同意を409にする", async () => {
    vi.mocked(acceptServiceTerms).mockResolvedValue({
      type: "version-conflict",
      currentVersion: currentServiceTerms.version,
    });
    const response = await app.request(
      "/api/legal/terms/acceptance",
      {
        method: "PUT",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({ version: "2026-01-01" }),
      },
      { DB: db, LIFF_ID: "2010850319-Yl63upAR" },
    );
    expect(response.status).toBe(409);
  });
});
