import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { issueCompatibilityInvitation } from "./compatibility-invitation";

const previewToken = `csp2.${"a".repeat(64)}`;
const relationshipId = "1".repeat(64);
const at = new Date("2026-08-12T00:00:00.000Z");
const expiresAt = new Date("2026-08-26T00:00:00.000Z");
const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;

function dependencies(overrides: Record<string, unknown> = {}) {
  const base = {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user", displayName: " あおい " },
    }),
    getPreviewSource: vi.fn().mockResolvedValue({
      diagnoses: [{ id: "diagnosis-1", availability: "open", responseStatus: "answered" }],
      answeredDiagnoses: [
        {
          id: "diagnosis-1",
          title: "時間と予定",
          answers: [],
          scoringConfig: { id: "scoring-1" },
        },
      ],
    }),
    getShareProfile: vi.fn().mockResolvedValue({
      type: "available",
      profile: {
        profileSummaryVersionId: "profile-version-1",
        generatedAt: "2026-08-11T00:00:00.000Z",
        statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
        fingerprint: "b".repeat(64),
      },
    }),
    scoreAnswers: vi.fn().mockReturnValue({
      scoringVersion: 1,
      balancedLabel: "状況による",
      parameters: [
        {
          id: "planning",
          label: "予定",
          lowLabel: "その場",
          highLabel: "早め",
          score: 80,
          coverage: 100,
          band: "high" as const,
        },
      ],
    }),
    createPreviewToken: vi.fn().mockResolvedValue(previewToken),
    createThemeFingerprints: vi
      .fn()
      .mockResolvedValue([{ diagnosisId: "diagnosis-1", resultFingerprint: "c".repeat(64) }]),
    createInvitation: vi.fn().mockResolvedValue({
      outcome: "created",
      relationship: {
        id: relationshipId,
        expiresAt,
      },
    }),
  };
  return { ...base, ...overrides } as typeof base;
}

describe("issueCompatibilityInvitation", () => {
  it("現在のpreviewを再計算し、プロフィールとテーマの同意指紋から招待を作る", async () => {
    const deps = dependencies();
    const result = await issueCompatibilityInvitation(
      {
        idToken: "id-token",
        previewToken,
        lineLoginChannelId: "channel-id",
        liffId: "1234567890-testliff",
        db,
        accountData,
        compatibilityData,
        at,
      },
      deps,
    );

    expect(result).toEqual({
      type: "created",
      invitationUrl: `https://liff.line.me/1234567890-testliff/compatibility/invitations/${relationshipId}`,
      expiresAt: expiresAt.toISOString(),
    });
    expect(deps.createInvitation).toHaveBeenCalledWith(accountData, compatibilityData, {
      inviterAccountId: "account-1",
      inviterDisplayName: "あおい",
      offeredProfile: {
        profileSummaryVersionId: "profile-version-1",
        fingerprint: "b".repeat(64),
      },
      offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "c".repeat(64) }],
    });
  });

  it("確認後にpreviewが変わった場合は招待を作らない", async () => {
    const deps = dependencies({
      createPreviewToken: vi.fn().mockResolvedValue(`csp2.${"d".repeat(64)}`),
    });

    await expect(
      issueCompatibilityInvitation(
        {
          idToken: "id-token",
          previewToken,
          lineLoginChannelId: "channel-id",
          liffId: "1234567890-testliff",
          db,
          accountData,
          compatibilityData,
          at,
        },
        deps,
      ),
    ).resolves.toEqual({ type: "preview-changed" });
    expect(deps.createInvitation).not.toHaveBeenCalled();
  });
});
