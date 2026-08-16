import type {
  AccountDataNamespace,
  CompatibilityDataNamespace,
  CompatibilityReference,
  CompatibilityRelationship,
} from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createLiffSession, resolveCompatibilityRelationshipContents } = vi.hoisted(() => ({
  createLiffSession: vi.fn(),
  resolveCompatibilityRelationshipContents: vi.fn(),
}));
vi.mock("./liff-session", () => ({ createLiffSession }));
vi.mock("./compatibility-relationship", () => ({ resolveCompatibilityRelationshipContents }));

const { listCompatibilityRelationships } = await import("./compatibility-relationships");

const accountId = "account-1";
const partnerAccountId = "account-2";
const pendingRelationshipId = "1".repeat(64);
const acceptedRelationshipId = "2".repeat(64);
const liffId = "1234567890-abcdefgh";
const expiresAt = new Date("2026-08-26T00:00:00.000Z");

function reference(overrides: Partial<CompatibilityReference>): CompatibilityReference {
  return {
    relationshipId: pendingRelationshipId,
    accountId,
    role: "inviter",
    partnerAccountId: null,
    status: "pending",
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    ...overrides,
  };
}

function acceptedRelationship(
  overrides: Partial<CompatibilityRelationship> = {},
): CompatibilityRelationship {
  const consentedAt = new Date("2026-08-11T00:00:00.000Z");
  return {
    id: acceptedRelationshipId,
    inviterAccountId: accountId,
    inviteeAccountId: partnerAccountId,
    inviterDisplayName: "あおい",
    inviteeDisplayName: "はる",
    relationshipCategory: "partner",
    status: "accepted",
    expiresAt,
    acceptedAt: consentedAt,
    cancelledAt: null,
    endedAt: null,
    endedByAccountId: null,
    createdAt: consentedAt,
    updatedAt: consentedAt,
    ...overrides,
  };
}

/**
 * 一覧参照とCompatibilityDataの現在状態を、関係IDごとに別々へ差し替える。
 */
function namespaces({
  references,
  previews = {},
  relationships = {},
}: {
  references: readonly CompatibilityReference[];
  previews?: Record<string, { expiresAt: Date; relationshipCategory?: "partner" } | null>;
  relationships?: Record<string, CompatibilityRelationship | null>;
}) {
  const execute = vi.fn(async (id: string, operation: string) => {
    if (id !== accountId) throw new Error("AccountData test routing mismatch");
    if (operation !== "compatibility.listVisibleReferences") {
      throw new Error(`Unsupported AccountData test operation: ${operation}`);
    }
    return references;
  });
  const accountData = { getByName: vi.fn(() => ({ execute })) } as unknown as AccountDataNamespace;

  const getInvitationPreview = vi.fn(async (relationshipId: string) => {
    const preview = previews[relationshipId] ?? null;
    return preview
      ? {
          ...preview,
          id: relationshipId,
          relationshipCategory: preview.relationshipCategory ?? "partner",
        }
      : null;
  });
  const getRelationship = vi.fn(
    async (relationshipId: string) => relationships[relationshipId] ?? null,
  );
  const compatibilityData = {
    getByName: vi.fn(() => ({ getInvitationPreview, getRelationship })),
  } as unknown as CompatibilityDataNamespace;

  return { accountData, compatibilityData, getInvitationPreview, getRelationship };
}

function request(
  accountData: AccountDataNamespace,
  compatibilityData: CompatibilityDataNamespace,
  viewerAccountId = accountId,
) {
  return listCompatibilityRelationships({
    actor: {
      accountId: viewerAccountId,
      authenticationMethod: "liff",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    },
    accountData,
    compatibilityData,
    liffId,
  });
}

describe("listCompatibilityRelationships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId, role: "user", displayName: "あおい" },
    });
    resolveCompatibilityRelationshipContents.mockResolvedValue({
      status: "ready",
      viewer: { themes: [{}] },
    });
  });

  it("pendingの招待は再送できる正規LIFF URLと期限を返す", async () => {
    const { accountData, compatibilityData } = namespaces({
      references: [reference({})],
      previews: { [pendingRelationshipId]: { expiresAt } },
    });

    await expect(request(accountData, compatibilityData)).resolves.toEqual({
      type: "resolved",
      items: [
        {
          relationshipId: pendingRelationshipId,
          relationshipCategory: "partner",
          status: "pending",
          expiresAt: expiresAt.toISOString(),
          invitationUrl: `https://liff.line.me/${liffId}/compatibility/invitations/${pendingRelationshipId}`,
        },
      ],
    });
  });

  it("比較できる関係は相手の表示名とテーマ数を返し、Account IDを外へ出さない", async () => {
    const { accountData, compatibilityData } = namespaces({
      references: [reference({ relationshipId: acceptedRelationshipId, status: "active" })],
      relationships: { [acceptedRelationshipId]: acceptedRelationship() },
    });

    const outcome = await request(accountData, compatibilityData);

    expect(outcome).toEqual({
      type: "resolved",
      items: [
        {
          relationshipId: acceptedRelationshipId,
          relationshipCategory: "partner",
          status: "accepted",
          partnerDisplayName: "はる",
          readiness: { status: "ready", comparableThemeCount: 1 },
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain(partnerAccountId);
  });

  it("受信者として成立した関係では送信者を相手として表示する", async () => {
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId: partnerAccountId, role: "user", displayName: "はる" },
    });
    const invitee = reference({
      relationshipId: acceptedRelationshipId,
      accountId: partnerAccountId,
      role: "invitee",
      partnerAccountId: accountId,
      status: "active",
    });
    const execute = vi.fn(async () => [invitee]);
    const accountData = {
      getByName: vi.fn(() => ({ execute })),
    } as unknown as AccountDataNamespace;
    const compatibilityData = {
      getByName: vi.fn(() => ({
        getRelationship: vi.fn(async () => acceptedRelationship()),
        getInvitationPreview: vi.fn(async () => null),
      })),
    } as unknown as CompatibilityDataNamespace;

    await expect(request(accountData, compatibilityData, partnerAccountId)).resolves.toEqual({
      type: "resolved",
      items: [
        {
          relationshipId: acceptedRelationshipId,
          relationshipCategory: "partner",
          status: "accepted",
          partnerDisplayName: "あおい",
          readiness: { status: "ready", comparableThemeCount: 1 },
        },
      ],
    });
  });

  it("正本側で利用できなくなった参照は一覧から除く", async () => {
    const { accountData, compatibilityData } = namespaces({
      references: [
        reference({}),
        reference({ relationshipId: acceptedRelationshipId, status: "active" }),
      ],
      // 期限切れのpendingと、終了済みのacceptedはどちらもnullで返る。
      previews: { [pendingRelationshipId]: null },
      relationships: { [acceptedRelationshipId]: null },
    });

    await expect(request(accountData, compatibilityData)).resolves.toEqual({
      type: "resolved",
      items: [],
    });
  });

  it("参照の並び順を保ったまま複数の関係を返す", async () => {
    const { accountData, compatibilityData } = namespaces({
      references: [
        reference({}),
        reference({ relationshipId: acceptedRelationshipId, status: "active" }),
      ],
      previews: { [pendingRelationshipId]: { expiresAt } },
      relationships: { [acceptedRelationshipId]: acceptedRelationship() },
    });

    const outcome = await request(accountData, compatibilityData);

    expect(outcome.type).toBe("resolved");
    if (outcome.type !== "resolved") throw new Error("outcome should be resolved");
    expect(outcome.items.map((item) => item.status)).toEqual(["pending", "accepted"]);
  });

  it.each(["diagnosis", "profile-summary", null] as const)(
    "準備中の関係は本人の次の操作だけを返す (%s)",
    async (nextAction) => {
      resolveCompatibilityRelationshipContents.mockResolvedValueOnce({
        status: "waiting",
        nextAction,
      });
      const { accountData, compatibilityData } = namespaces({
        references: [reference({ relationshipId: acceptedRelationshipId, status: "active" })],
        relationships: { [acceptedRelationshipId]: acceptedRelationship() },
      });

      await expect(request(accountData, compatibilityData)).resolves.toEqual({
        type: "resolved",
        items: [
          {
            relationshipId: acceptedRelationshipId,
            relationshipCategory: "partner",
            status: "accepted",
            partnerDisplayName: "はる",
            readiness: { status: "waiting", nextAction },
          },
        ],
      });
    },
  );

  it("参照が無ければ空の一覧を返す", async () => {
    const { accountData, compatibilityData } = namespaces({ references: [] });

    await expect(request(accountData, compatibilityData)).resolves.toEqual({
      type: "resolved",
      items: [],
    });
  });
});
