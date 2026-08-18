import { describe, expect, it } from "vitest";
import { diaryChatSafetyFixtures } from "../evaluation/diary-chat-safety-fixtures";
import {
  JAPAN_ABUSE_VIOLENCE_SUPPORT_URL,
  JAPAN_MENTAL_HEALTH_SUPPORT_URL,
  buildDevelopmentBrainUsageMessage,
  buildDiaryChatContextPackage,
  buildSafetyFallback,
  classifySafety,
  stricterSafetyRoute,
  validateDiaryChatResponse,
} from "./diary-chat";

const messages = [
  { id: "message-1", role: "user" as const, body: "今日は仕事で失敗して落ち込んだ", sequence: 1 },
];

describe("diary chat guardrails", () => {
  it("開発環境では実際に使用したBrain Itemを返信末尾へ追加する", () => {
    const memories = [{ category: "memory", statement: "公園を歩くと落ち着くことがある" }];

    expect(buildDevelopmentBrainUsageMessage(memories, "development")).toBe(
      "[dev] 使用したBrain Item\n- 1. Memory: 公園を歩くと落ち着くことがある",
    );
    expect(buildDevelopmentBrainUsageMessage(memories, "preview")).toContain(
      "[dev] 使用したBrain Item",
    );
    expect(buildDevelopmentBrainUsageMessage(memories, "production")).toBeUndefined();
  });

  it("Brain Itemを使用していない場合は開発環境でも返信を変更しない", () => {
    expect(buildDevelopmentBrainUsageMessage([], "development")).toBeUndefined();
  });

  it("開発用表示ではBrain Itemのstatementだけを500文字に制限する", () => {
    const result = buildDevelopmentBrainUsageMessage(
      [{ category: "memory", statement: "記".repeat(501) }],
      "development",
    );

    expect(result).toBe(`[dev] 使用したBrain Item\n- 1. Memory: ${"記".repeat(500)}`);
  });

  it("schemaと質問数を検証する", () => {
    const valid = JSON.stringify({
      mode: "explore",
      reply: "それは落ち込むよね。いちばん悔しかったのはどこ？",
      main_question_count: 1,
      end_session: false,
      daily_prompt_follow_up: "none",
      collection_theme_id: "none",
      collection_kind: "none",
      safety: { route: "normal", restricted_advice: false },
      used_memory_ids: [],
    });
    expect(validateDiaryChatResponse(valid, "normal")?.mode).toBe("explore");
  });

  it("モデルが返したmemory IDはContextに存在するものだけを監査対象にする", () => {
    const raw = JSON.stringify({
      mode: "advise",
      reply: "以前うまくいった方法も選択肢にできそうです。",
      main_question_count: 0,
      end_session: false,
      daily_prompt_follow_up: "none",
      collection_theme_id: "none",
      collection_kind: "none",
      safety: { route: "normal", restricted_advice: false },
      used_memory_ids: ["memory-1", "memory-unknown", "memory-1"],
    });

    expect(validateDiaryChatResponse(raw, "normal", ["memory-1"])?.used_memory_ids).toEqual([
      "memory-1",
    ]);
  });

  it("許可済み候補の属性確認質問だけを収集対象として返す", () => {
    const raw = JSON.stringify({
      mode: "explore",
      reply: "仕事が大変だったんだね。そういえば、どんな仕事をしているの？",
      main_question_count: 1,
      end_session: false,
      daily_prompt_follow_up: "none",
      collection_theme_id: "life_schedule",
      collection_kind: "occupation",
      safety: { route: "normal", restricted_advice: false },
      used_memory_ids: [],
    });
    const candidates = [
      {
        themeId: "life_schedule" as const,
        kinds: ["occupation" as const],
        remainingQuestionCount: 2,
      },
    ];

    expect(validateDiaryChatResponse(raw, "normal", [], candidates)?.collection_target).toEqual({
      themeId: "life_schedule",
      kind: "occupation",
    });
    expect(validateDiaryChatResponse(raw, "normal")).toBeUndefined();
  });

  it("属性確認を記録する場合は主質問1件を必須にする", () => {
    const raw = JSON.stringify({
      mode: "listen",
      reply: "仕事が大変だったんだね。",
      main_question_count: 0,
      end_session: false,
      daily_prompt_follow_up: "none",
      collection_theme_id: "life_schedule",
      collection_kind: "occupation",
      safety: { route: "normal", restricted_advice: false },
      used_memory_ids: [],
    });

    expect(
      validateDiaryChatResponse(
        raw,
        "normal",
        [],
        [
          {
            themeId: "life_schedule",
            kinds: ["occupation"],
            remainingQuestionCount: 2,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("モデルが安全routeを強化した応答では属性確認を許可しない", () => {
    const raw = JSON.stringify({
      mode: "organize",
      reply: "安全を優先しよう。ところで、どんな仕事をしているの？",
      main_question_count: 1,
      end_session: false,
      daily_prompt_follow_up: "none",
      collection_theme_id: "life_schedule",
      collection_kind: "occupation",
      safety: { route: "self_harm_possible", restricted_advice: true },
      used_memory_ids: [],
    });

    expect(
      validateDiaryChatResponse(
        raw,
        "normal",
        [],
        [
          {
            themeId: "life_schedule",
            kinds: ["occupation"],
            remainingQuestionCount: 2,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("事前分類よりモデルの安全routeを弱めない", () => {
    expect(stricterSafetyRoute("self_harm_possible", "normal")).toBe("self_harm_possible");
  });

  it.each(["same_day", "next_day"] as const)(
    "通常routeで質問を残さずSessionを終える応答だけ%sフォローを許可する",
    (followUp) => {
      const valid = JSON.stringify({
        mode: "close",
        reply: "いったんここまでにしよう。またあとで聞かせてね。",
        main_question_count: 0,
        end_session: true,
        daily_prompt_follow_up: followUp,
        collection_theme_id: "none",
        collection_kind: "none",
        safety: { route: "normal", restricted_advice: false },
        used_memory_ids: [],
      });
      const openSession = JSON.stringify({
        ...JSON.parse(valid),
        end_session: false,
      });
      const unansweredQuestion = JSON.stringify({
        ...JSON.parse(valid),
        main_question_count: 1,
      });
      const unsafe = JSON.stringify({
        ...JSON.parse(valid),
        safety: { route: "high_stakes", restricted_advice: true },
      });

      expect(validateDiaryChatResponse(valid, "normal")?.daily_prompt_follow_up).toBe(followUp);
      expect(validateDiaryChatResponse(openSession, "normal")).toBeUndefined();
      expect(validateDiaryChatResponse(unansweredQuestion, "normal")).toBeUndefined();
      expect(validateDiaryChatResponse(unsafe, "normal")).toBeUndefined();
    },
  );

  it("自傷の可能性を検知して危機向けfallbackを返す", () => {
    const route = classifySafety([
      { id: "message-2", role: "user", body: "消えてしまいたい", sequence: 2 },
    ]);
    expect(route).toBe("self_harm_possible");
    const response = buildSafetyFallback(route);
    expect(response).toMatchObject({
      main_question_count: 1,
      safety: { route: "self_harm_possible", restricted_advice: true },
    });
    expect(response.reply).toContain(JAPAN_MENTAL_HEALTH_SUPPORT_URL);
    expect(response.reply).not.toMatch(/119|110/u);
  });

  it("119と110は差し迫った危険の定型案内だけに含める", () => {
    expect(buildSafetyFallback("imminent_danger").reply).toMatch(/119.*110/u);
    const abuseResponse = buildSafetyFallback("abuse_or_violence").reply;
    expect(abuseResponse).toContain(JAPAN_ABUSE_VIOLENCE_SUPPORT_URL);
    expect(abuseResponse).not.toMatch(/119|110/u);
  });

  it("通常時のfallbackへ会話継続だけの質問を付けない", () => {
    expect(buildSafetyFallback("normal")).toMatchObject({
      main_question_count: 0,
      safety: { route: "normal", restricted_advice: false },
    });
  });

  it("通常の日記を危機扱いしない", () => {
    expect(classifySafety(messages)).toBe("normal");
  });

  it("連投Turnの先頭にある危機表現も見落とさない", () => {
    const coalesced = [
      { id: "first", role: "user" as const, body: "死にたい", sequence: 1 },
      { id: "second", role: "user" as const, body: "でも今日は仕事した", sequence: 2 },
    ];
    expect(classifySafety(coalesced, ["first", "second"])).toBe("self_harm_possible");
  });

  it.each(diaryChatSafetyFixtures)(
    "$idを決定的な安全分類の期待routeへ送る",
    ({ input, expectedPreclassifiedRoute }) => {
      expect(classifySafety([{ id: "fixture", role: "user", body: input, sequence: 1 }])).toBe(
        expectedPreclassifiedRoute,
      );
    },
  );

  it("再認可済みBrain Itemを推定区分とEvidence付きでContext Packageへ入れる", () => {
    expect(
      buildDiaryChatContextPackage(messages, "normal", [
        {
          brainItemId: "brain-1",
          category: "memory",
          statement: "公園を歩くと落ち着くことがある",
          derivation: "ai",
          isInference: false,
          status: "active",
          confidence: { state: "uncomputed" },
          accessLabels: ["unclassified"],
          firstObservedAt: new Date("2026-08-01T00:00:00Z"),
          lastObservedAt: new Date("2026-08-10T00:00:00Z"),
          evidence: [
            {
              sourceRecordId: "source-1",
              text: "公園を散歩したら落ち着いた",
              recordedAt: new Date("2026-08-10T00:00:00Z"),
            },
          ],
        },
      ]).memories,
    ).toEqual([
      {
        id: "memory-1",
        category: "memory",
        statement: "公園を歩くと落ち着くことがある",
        derivation: "ai",
        is_inference: false,
        status: "active",
        confidence: { state: "uncomputed" },
        access_labels: ["unclassified"],
        first_observed_at: new Date("2026-08-01T00:00:00Z"),
        last_observed_at: new Date("2026-08-10T00:00:00Z"),
        evidence: [
          {
            id: "evidence-1-1",
            text: "公園を散歩したら落ち着いた",
            recorded_at: new Date("2026-08-10T00:00:00Z"),
          },
        ],
      },
    ]);
  });

  it("MemoryとEvidenceでContext token budgetを過剰消費しないよう文字数を制限する", () => {
    const context = buildDiaryChatContextPackage(messages, "normal", [
      {
        brainItemId: "brain-1",
        category: "memory",
        statement: "記".repeat(2_001),
        derivation: "deterministic",
        isInference: false,
        status: "active",
        confidence: { state: "confirmed" },
        accessLabels: ["private"],
        firstObservedAt: new Date("2026-08-01T00:00:00Z"),
        lastObservedAt: new Date("2026-08-10T00:00:00Z"),
        evidence: [
          {
            sourceRecordId: "source-1",
            text: "根".repeat(1_001),
            recordedAt: new Date("2026-08-10T00:00:00Z"),
          },
        ],
      },
    ]);

    expect(context.memories[0]?.statement).toHaveLength(2_000);
    expect(context.memories[0]?.evidence[0]?.text).toHaveLength(1_000);
  });

  it("関係性Contextへ本人の関連診断だけを直列化し、所有者IDをモデルへ渡さない", () => {
    const context = buildDiaryChatContextPackage(messages, "normal", [], {
      accountId: "account-1",
      mode: "session-and-diagnosis",
      personReferenceStatus: "confirmed",
      category: "friend",
      diagnoses: [
        {
          ownerAccountId: "account-1",
          diagnosisId: "friend-style",
          relationshipCategory: "friend",
          statement: "気持ちを言葉で確認する傾向がある",
        },
        {
          ownerAccountId: "third-party",
          diagnosisId: "private-third-party",
          relationshipCategory: "friend",
          statement: "共有されていない第三者情報",
        },
      ],
      sharedRelationships: [{ relationshipCategory: "friend", partnerDisplayName: "美咲" }],
      matchedSharedRelationship: {
        relationshipCategory: "friend",
        partnerDisplayName: "美咲",
      },
    });

    expect(context.relationship_question).toEqual({
      context_scope: "session-and-diagnosis",
      person_reference_status: "confirmed",
      relationship_category: "friend",
      own_diagnoses: [
        {
          diagnosis_id: "friend-style",
          relationship_category: "friend",
          statement: "気持ちを言葉で確認する傾向がある",
        },
      ],
      shared_relationships: [
        {
          relationship_category: "friend",
          partner_display_name: "美咲",
          matches_current_person: true,
        },
      ],
    });
    expect(JSON.stringify(context)).not.toContain("account-1");
    expect(JSON.stringify(context)).not.toContain("private-third-party");
  });
});
