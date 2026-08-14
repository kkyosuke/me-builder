import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/compatibility-api.md を参照する。
export const compatibilityShareCases = {
  completedDiagnosis: {
    id: "COMPATIBILITY-CONSENT-001",
    name: "共有可否と表示名だけを返し、共有される内容を返さないこと",
    in: {
      method: "GET",
      path: "/api/compatibility/share-consent",
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
        avatarUrl: "/api/profile/avatar",
        canShare: true,
        blockingReasons: [],
        nextAction: null,
        excludedFields: ["aboutMe", "themes", "previewToken", "accountId", "fingerprint"],
      },
    },
  },
  issueInvitation: {
    id: "COMPATIBILITY-INVITATION-001",
    name: "共有への同意だけで1人用の招待リンクを発行すること",
    in: {
      method: "POST",
      path: "/api/compatibility/invitations",
      authorization: "Bearer known-token",
      body: { relationshipCategory: "partner" },
      setup: ["共有できる内容がまだない状態でも発行できることを含める"],
    },
    out: {
      status: 201,
      body: {
        invitationUrlPattern:
          "^https://liff\\.line\\.me/1234567890-testliff/compatibility/invitations/[a-f0-9]{64}$",
        expiresAt: "CompatibilityDataが決定する14日後のISO日時",
        relationshipCategory: "partner",
        senderReferenceStatus: "pending",
      },
    },
  },
  previewInvitation: {
    id: "COMPATIBILITY-INVITATION-PREVIEW-001",
    name: "別Accountが保存なしで招待者と共有可否だけを確認できること",
    in: {
      method: "GET",
      path: "/api/compatibility/invitations/:relationshipId",
      authorization: "Bearer recipient-token",
      setup: ["送信者が招待を発行"],
    },
    out: {
      status: 200,
      body: {
        inviterDisplayName: "あおい",
        recipientDisplayName: "はる",
        canAccept: true,
        relationshipCategory: "partner",
        relationshipStatus: "pending",
        recipientReferenceCount: 0,
        excludedFields: ["aboutMe", "themes", "accountId", "fingerprint", "choiceId", "evidenceId"],
      },
    },
  },
  acceptWithoutSharableContent: {
    id: "COMPATIBILITY-INVITATION-PREVIEW-002",
    name: "共有できる内容がまだなくても承諾でき、そろった時点で自動的に相性シートへ反映されること",
    in: {
      method: "POST",
      path: "/api/compatibility/invitations/:relationshipId/accept",
      authorization: "Bearer recipient-token",
      setup: ["受信者がDiagnosis未回答・共有プロフィール未生成のまま承諾"],
    },
    out: {
      status: 200,
      body: {
        relationshipStatus: "accepted",
        detailStatusBeforePreparation: "waiting",
        detailNextActionBeforePreparation: "profile-summary",
        listStatusBeforePreparation: "waiting",
        detailStatusAfterPreparation: "ready",
        listStatusAfterPreparation: "ready",
        reconsentRequired: false,
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
    name: "受信者の共有同意で相性関係と双方の一覧参照を成立させること",
    in: {
      method: "POST",
      path: "/api/compatibility/invitations/:relationshipId/accept",
      authorization: "Bearer recipient-token",
      setup: ["送信者と受信者が共通Diagnosisを完了して共有プロフィールを生成"],
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
    name: "双方が相手を先にした、現在の内容から組み立てた同じ相性シートを取得できること",
    in: {
      method: "GET",
      path: "/api/compatibility/relationships/:relationshipId",
      authorization: "Bearer participant-token",
      setup: [
        "送信者と受信者が招待を承諾して相性関係を成立",
        "承諾後に送信者のわたしのまとめを再生成",
      ],
    },
    out: {
      status: 200,
      body: {
        status: "ready",
        partnerFirst: true,
        commonThemeCount: 1,
        latestProfileShared: true,
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
        bothAfterAcceptance: "ready",
      },
    },
  },
  cancelInvitation: {
    id: "COMPATIBILITY-INVITATION-CANCEL-001",
    name: "送信者が招待を取り消すと内容と一覧から消えること",
    in: {
      method: "DELETE",
      path: "/api/compatibility/invitations/:relationshipId",
      authorization: "Bearer inviter-token",
      setup: ["送信者が招待を発行"],
    },
    out: {
      status: 204,
      body: {
        relationshipStatus: "cancelled",
        invitationPreviewStatus: 404,
        senderList: "empty",
      },
    },
  },
  endRelationship: {
    id: "COMPATIBILITY-RELATIONSHIP-END-001",
    name: "片方が共有を終了すると双方の一覧と相性シートから消えること",
    in: {
      method: "DELETE",
      path: "/api/compatibility/relationships/:relationshipId",
      authorization: "Bearer recipient-token",
      setup: ["送信者と受信者が招待を承諾して相性関係を成立"],
    },
    out: {
      status: 204,
      body: {
        relationshipStatus: "ended",
        bothLists: "empty",
        bothDetailStatuses: 404,
      },
    },
  },
  shareJourney: {
    id: "COMPATIBILITY-SHARE-JOURNEY-001",
    name: "LIFF共有リンクの発行から受信者の招待内容表示まで到達できること",
    in: {
      method: "GET",
      path: "/api/compatibility/invitations/:relationshipId",
      authorization: "Bearer recipient-token",
      setup: [
        "送信者が共有へ同意してLIFF招待リンクを発行",
        "受信者がリンク内のrelationshipIdで招待画面の表示内容を取得",
      ],
    },
    out: {
      status: 200,
      body: {
        invitationUrlOrigin: "https://liff.line.me/1234567890-testliff",
        inviterDisplayName: "あおい",
        recipientDisplayName: "はる",
        canAccept: true,
      },
    },
  },
} as const satisfies Record<string, E2eCase>;
