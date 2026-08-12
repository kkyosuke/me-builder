import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/compatibility-api.md を参照する。
export const compatibilitySharePreviewCases = {
  completedDiagnosis: {
    id: "COMPATIBILITY-PREVIEW-001",
    name: "回答完了後に共有可能な傾向だけを返すこと",
    in: {
      method: "GET",
      path: "/api/compatibility/share-preview",
      authorization: "Bearer known-token",
      setup: [
        "migrationとdiagnosis seedを適用",
        "relationship-priorityの10問すべてへchoiceId=yesを保存",
      ],
    },
    out: {
      status: 200,
      body: {
        displayName: "あおい",
        previewTokenPattern: "^csp2\\.[a-f0-9]{64}$",
        canIssueInvitation: true,
        blockingReasons: [],
        nextAction: null,
        themeCount: 1,
        parameterCount: 4,
        excludedFields: ["choiceId", "questionText", "coverage", "accountId", "fingerprint"],
      },
    },
  },
  issueInvitation: {
    id: "COMPATIBILITY-INVITATION-001",
    name: "確認済みの共有内容から1人用の招待リンクを発行すること",
    in: {
      method: "POST",
      path: "/api/compatibility/invitations",
      authorization: "Bearer known-token",
      setup: [
        "共有プロフィールを生成",
        "relationship-priorityの10問すべてへchoiceId=yesを保存",
        "共有プレビューのpreviewTokenを送信",
      ],
    },
    out: {
      status: 201,
      body: {
        invitationUrlPattern: "^https://example\\.com/compatibility/invitations/[a-f0-9]{64}$",
        expiresAt: "CompatibilityDataが決定する14日後のISO日時",
        senderReferenceStatus: "pending",
      },
    },
  },
  previewInvitation: {
    id: "COMPATIBILITY-INVITATION-PREVIEW-001",
    name: "別Accountが保存なしで双方の共有内容を確認できること",
    in: {
      method: "GET",
      path: "/api/compatibility/invitations/:relationshipId",
      authorization: "Bearer recipient-token",
      setup: [
        "送信者と受信者が共通Diagnosisを完了して共有プロフィールを生成",
        "送信者が共有プレビューから招待を発行",
      ],
    },
    out: {
      status: 200,
      body: {
        inviterDisplayName: "あおい",
        recipientDisplayName: "はる",
        commonThemeCount: 1,
        relationshipStatus: "pending",
        recipientReferenceCount: 0,
        excludedFields: ["accountId", "fingerprint", "choiceId", "evidenceId"],
      },
    },
  },
  previewInvitationWithIncompleteRecipient: {
    id: "COMPATIBILITY-INVITATION-PREVIEW-002",
    name: "受信者の準備が未完了なら保存せずに必要な次アクションを返すこと",
    in: {
      method: "GET",
      path: "/api/compatibility/invitations/:relationshipId",
      authorization: "Bearer recipient-token",
      setup: [
        "送信者だけがDiagnosisを完了して共有プロフィールを生成",
        "送信者が共有プレビューから招待を発行",
      ],
    },
    out: {
      status: 200,
      body: {
        canAccept: false,
        blockingReasons: [
          "profile_summary_required",
          "diagnosis_required",
          "common_diagnosis_required",
        ],
        nextAction: "profile-summary",
        relationshipStatus: "pending",
        recipientReferenceCount: 0,
      },
    },
  },
  previewCancelledInvitation: {
    id: "COMPATIBILITY-INVITATION-PREVIEW-003",
    name: "取消済みの招待内容を開示しないこと",
    in: {
      method: "GET",
      path: "/api/compatibility/invitations/:relationshipId",
      authorization: "Bearer recipient-token",
      setup: ["送信者が招待を発行", "送信者が招待を取り消す"],
    },
    out: {
      status: 404,
      body: {
        error: "Compatibility invitation unavailable",
        reason: "invitation_unavailable",
        recipientReferenceCount: 0,
      },
    },
  },
  acceptInvitation: {
    id: "COMPATIBILITY-INVITATION-ACCEPT-001",
    name: "確認した共有内容で相性関係と双方の一覧参照を成立させること",
    in: {
      method: "POST",
      path: "/api/compatibility/invitations/:relationshipId/accept",
      authorization: "Bearer recipient-token",
      setup: [
        "送信者と受信者が共通Diagnosisを完了して共有プロフィールを生成",
        "招待確認APIで受信者のpreviewTokenを確認",
      ],
    },
    out: {
      status: 200,
      body: {
        status: "accepted",
        relationshipStatus: "accepted",
        inviterReferenceStatus: "active",
        recipientReferenceStatus: "active",
      },
    },
  },
  relationshipDetail: {
    id: "COMPATIBILITY-RELATIONSHIP-DETAIL-001",
    name: "双方が相手を先にした同じ同意済み相性シートを取得できること",
    in: {
      method: "GET",
      path: "/api/compatibility/relationships/:relationshipId",
      authorization: "Bearer participant-token",
      setup: ["送信者と受信者が招待を承諾して相性関係を成立"],
    },
    out: {
      status: 200,
      body: {
        status: "ready",
        partnerFirst: true,
        commonThemeCount: 1,
        excludedFields: ["accountId", "fingerprint", "choiceId", "evidenceId"],
      },
    },
  },
  relationshipList: {
    id: "COMPATIBILITY-RELATIONSHIP-LIST-001",
    name: "発行中招待と成立中関係を当事者の一覧へ反映すること",
    in: {
      method: "GET",
      path: "/api/compatibility/relationships",
      authorization: "Bearer participant-token",
      setup: ["送信者が招待を発行し、受信者が承諾"],
    },
    out: {
      status: 200,
      body: {
        senderBeforeAcceptance: "pending",
        recipientBeforeAcceptance: "empty",
        bothAfterAcceptance: "accepted",
      },
    },
  },
} as const satisfies Record<string, E2eCase>;
