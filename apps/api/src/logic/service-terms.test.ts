import type { D1 } from "@me-builder/lib";
import { currentServiceTerms } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import {
  acceptServiceTerms,
  getServiceTermsAcceptanceHistory,
  getServiceTermsStatus,
} from "./service-terms";

const db = {} as D1.shared.Client;
const session = {
  type: "resolved" as const,
  session: { accountId: "account-1", role: "user" as const },
};

function dependencies(acceptance?: { acceptedAt: string }) {
  return {
    createSession: vi.fn().mockResolvedValue(session),
    findAcceptance: vi.fn().mockResolvedValue(
      acceptance
        ? {
            id: "acceptance-1",
            accountId: "account-1",
            documentKey: "terms_of_service" as const,
            documentVersion: currentServiceTerms.version,
            documentHash: currentServiceTerms.contentHash,
            acceptedAt: acceptance.acceptedAt,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            isDeleted: false,
          }
        : undefined,
    ),
    listAcceptanceHistory: vi.fn().mockResolvedValue([]),
    accept: vi.fn().mockResolvedValue({
      id: "acceptance-1",
      accountId: "account-1",
      documentKey: "terms_of_service" as const,
      documentVersion: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
      acceptedAt: "2026-08-15T01:23:45.000Z",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      isDeleted: false,
    }),
  };
}

describe("service terms", () => {
  it("現在versionが未同意なら本文とrequiredを返す", async () => {
    const deps = dependencies();
    const result = await getServiceTermsStatus(
      { idToken: "token", lineLoginChannelId: "channel", db },
      deps,
    );
    expect(result).toMatchObject({
      type: "resolved",
      document: { documentKey: "terms_of_service", version: currentServiceTerms.version },
      acceptance: { required: true, acceptedAt: null },
    });
  });

  it("同意済みなら保存済み日時を返す", async () => {
    const result = await getServiceTermsStatus(
      { idToken: "token", lineLoginChannelId: "channel", db },
      dependencies({ acceptedAt: "2026-08-15T01:23:45.000Z" }),
    );
    expect(result).toMatchObject({
      type: "resolved",
      acceptance: { required: false, acceptedAt: "2026-08-15T01:23:45.000Z" },
    });
  });

  it("表示したversionが古ければ同意を保存しない", async () => {
    const deps = dependencies();
    const result = await acceptServiceTerms(
      { idToken: "token", lineLoginChannelId: "channel", db, version: "2026-01-01" },
      deps,
    );
    expect(result).toEqual({
      type: "version-conflict",
      currentVersion: currentServiceTerms.version,
    });
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("現在versionの同意を認証済みAccountへ保存する", async () => {
    const deps = dependencies();
    const result = await acceptServiceTerms(
      {
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        version: currentServiceTerms.version,
      },
      deps,
    );
    expect(result).toMatchObject({ type: "accepted", acceptance: { accountId: "account-1" } });
    expect(deps.accept).toHaveBeenCalledWith(db, "account-1");
  });

  it("本人の同意履歴を現在有効・過去へ分類する", async () => {
    const deps = dependencies({ acceptedAt: "2026-08-15T02:00:00.000Z" });
    vi.mocked(deps.findAcceptance).mockResolvedValue({
      id: "acceptance-current",
      accountId: "account-1",
      documentKey: "terms_of_service",
      documentVersion: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
      acceptedAt: "2026-08-15T02:00:00.000Z",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      isDeleted: false,
    });
    vi.mocked(deps.listAcceptanceHistory).mockResolvedValue([
      {
        id: "acceptance-current",
        accountId: "account-1",
        documentKey: "terms_of_service",
        documentVersion: currentServiceTerms.version,
        documentHash: currentServiceTerms.contentHash,
        acceptedAt: "2026-08-15T02:00:00.000Z",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        isDeleted: false,
      },
      {
        id: "acceptance-past",
        accountId: "account-1",
        documentKey: "terms_of_service",
        documentVersion: "2026-08-15",
        documentHash: null,
        acceptedAt: "2026-08-15T01:00:00.000Z",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
        isDeleted: true,
      },
    ]);

    const result = await getServiceTermsAcceptanceHistory(
      { idToken: "token", lineLoginChannelId: "channel", db },
      deps,
    );

    expect(result).toMatchObject({
      type: "resolved",
      acceptances: [
        { version: currentServiceTerms.version, status: "current" },
        { version: "2026-08-15", documentHash: null, status: "past" },
      ],
    });
  });
});
