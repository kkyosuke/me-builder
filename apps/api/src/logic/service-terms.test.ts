import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { acceptServiceTerms, getServiceTermsStatus } from "./service-terms";

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
            documentVersion: "2026-08-15",
            acceptedAt: acceptance.acceptedAt,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            isDeleted: false,
          }
        : undefined,
    ),
    accept: vi.fn().mockResolvedValue({
      id: "acceptance-1",
      accountId: "account-1",
      documentKey: "terms_of_service" as const,
      documentVersion: "2026-08-15",
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
      document: { documentKey: "terms_of_service", version: "2026-08-15" },
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
    expect(result).toEqual({ type: "version-conflict", currentVersion: "2026-08-15" });
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("現在versionの同意を認証済みAccountへ保存する", async () => {
    const deps = dependencies();
    const result = await acceptServiceTerms(
      { idToken: "token", lineLoginChannelId: "channel", db, version: "2026-08-15" },
      deps,
    );
    expect(result).toMatchObject({ type: "accepted", acceptance: { accountId: "account-1" } });
    expect(deps.accept).toHaveBeenCalledWith(db, "account-1");
  });
});
