import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  PROMPT_CONTEXT_ATTRIBUTE_MASTER,
  PROMPT_CONTEXT_COLLECTION_GOAL,
  type PromptContext,
  PromptContextSchema,
  arePromptContextsEqual,
  findPrecedingAssistantBodies,
  isPromptContextGrounded,
  parsePromptContext,
  readPromptContext,
} from "./prompt-context";

describe("prompt context attribute master", () => {
  it("高優先の5属性と非強制の収集目標をSSoTとして公開する", () => {
    expect(PROMPT_CONTEXT_ATTRIBUTE_MASTER.map(({ kind }) => kind)).toEqual([
      "occupation",
      "weekly_rhythm",
      "recurring_schedule",
      "rest_window",
      "question_style",
    ]);
    expect(PROMPT_CONTEXT_COLLECTION_GOAL).toMatchObject({
      maxAttributeGroupsPerSession: 1,
      maxConfirmationQuestionsPerGroup: 2,
      requireCompletion: false,
      retryUnanswered: false,
      extractionMode: "explicit_only",
    });
  });

  it.each([
    ["identity", "看護師なの", { kind: "occupation", occupation: "看護師" }],
    [
      "behavior_pattern",
      "休みはシフトで変わるよ",
      { kind: "weekly_rhythm", scheduleMode: "variable_shift" },
    ],
    [
      "behavior_pattern",
      "土日休みだよ",
      {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["saturday", "sunday"],
      },
    ],
    [
      "behavior_pattern",
      "毎週月曜は塾に行っている",
      { kind: "recurring_schedule", activity: "塾", weekdays: ["monday"] },
    ],
    [
      "preference",
      "家に帰ってからなら落ち着いて返しやすい",
      { kind: "rest_window", window: "after_returning_home" },
    ],
    [
      "preference",
      "気分より何があったか聞かれる方が答えやすい",
      { kind: "question_style", style: "event_first" },
    ],
  ] as const)("%sの明言から構造化属性を検証する", (category, statement, rawPromptContext) => {
    const parsed = v.safeParse(PromptContextSchema, rawPromptContext);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("prompt context fixture is invalid");
    expect(isPromptContextGrounded(category, statement, parsed.output)).toBe(true);
  });

  it("職業だけからシフト制を補完した属性を拒否する", () => {
    expect(
      isPromptContextGrounded("behavior_pattern", "看護師なの", {
        kind: "weekly_rhythm",
        scheduleMode: "variable_shift",
      }),
    ).toBe(false);
  });

  it("第三者の職業を本人の属性として扱わない", () => {
    expect(
      isPromptContextGrounded("identity", "友達は看護師なの", {
        kind: "occupation",
        occupation: "看護師",
      }),
    ).toBe(false);
    expect(
      isPromptContextGrounded(
        "identity",
        "友達は看護師",
        { kind: "occupation", occupation: "友達は看護師" },
        ["そういえばどんな仕事してるの？"],
      ),
    ).toBe(false);
  });

  it("単語だけの職業は本人への直前質問がある場合だけ受理する", () => {
    const promptContext = { kind: "occupation", occupation: "看護師" } as const;
    expect(isPromptContextGrounded("identity", "看護師", promptContext)).toBe(false);
    expect(
      isPromptContextGrounded("identity", "看護師", promptContext, [
        "そういえばどんな仕事してるの？",
      ]),
    ).toBe(true);
    expect(
      isPromptContextGrounded("identity", "看護師", promptContext, [
        "お姉さんはどんな仕事をしているの？",
      ]),
    ).toBe(false);
  });

  it("Evidenceへ直接先行するassistant messageだけを補助文脈にする", () => {
    expect(
      findPrecedingAssistantBodies(
        [
          { id: "assistant-1", role: "assistant", body: "どんな仕事してるの？", sequence: 1 },
          { id: "user-1", role: "user", body: "看護師", sequence: 2 },
          { id: "assistant-2", role: "assistant", body: "休みは固定？", sequence: 3 },
          { id: "user-2", role: "user", body: "固定じゃない", sequence: 4 },
        ],
        ["user-1"],
      ),
    ).toEqual(["どんな仕事してるの？"]);
  });

  it("固定ではないという明言をfixed_weeklyとして扱わない", () => {
    expect(
      isPromptContextGrounded("behavior_pattern", "休みは固定じゃない", {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["sunday"],
      }),
    ).toBe(false);
    expect(
      isPromptContextGrounded("behavior_pattern", "休みは固定じゃない", {
        kind: "weekly_rhythm",
        scheduleMode: "variable_shift",
      }),
    ).toBe(true);
  });

  it("固定曜日は曜日を伴う場合だけ受理する", () => {
    expect(
      isPromptContextGrounded("behavior_pattern", "土日は休みじゃない", {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["saturday", "sunday"],
      }),
    ).toBe(false);
    expect(
      isPromptContextGrounded("behavior_pattern", "水曜が固定の休み", {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
        daysOff: ["wednesday"],
      }),
    ).toBe(true);
    expect(
      isPromptContextGrounded("behavior_pattern", "水曜が固定の休み", {
        kind: "weekly_rhythm",
        scheduleMode: "fixed_weekly",
      }),
    ).toBe(false);
  });

  it("平日勤務・土日休みを1つの正規形で保持する", () => {
    const promptContext: PromptContext = {
      kind: "weekly_rhythm",
      scheduleMode: "fixed_weekly",
      activeWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      daysOff: ["saturday", "sunday"],
    };
    expect(isPromptContextGrounded("behavior_pattern", "平日は仕事で土日休み", promptContext)).toBe(
      true,
    );
    expect(
      arePromptContextsEqual(promptContext, {
        ...promptContext,
        activeWeekdays: ["friday", "thursday", "wednesday", "tuesday", "monday"],
        daysOff: ["sunday", "saturday"],
      }),
    ).toBe(true);
  });

  it("occupationへ発言全文を入れた候補を拒否する", () => {
    expect(
      isPromptContextGrounded("identity", "看護師なの", {
        kind: "occupation",
        occupation: "看護師なの",
      }),
    ).toBe(false);
    expect(
      isPromptContextGrounded(
        "identity",
        "看護師だ",
        { kind: "occupation", occupation: "看護師だ" },
        ["どんな仕事してるの？"],
      ),
    ).toBe(false);
  });

  it("1回の塾の出来事を定期予定として扱わない", () => {
    expect(
      isPromptContextGrounded("behavior_pattern", "月曜は塾に行った", {
        kind: "recurring_schedule",
        activity: "塾",
        weekdays: ["monday"],
      }),
    ).toBe(false);
  });

  it("第三者の定期予定を本人の属性として扱わない", () => {
    expect(
      isPromptContextGrounded("behavior_pattern", "娘は毎週月曜に塾へ行く", {
        kind: "recurring_schedule",
        activity: "塾",
        weekdays: ["monday"],
      }),
    ).toBe(false);
  });

  it("永続化済みattributesからschema検証済みの属性だけを読む", () => {
    expect(
      readPromptContext({ promptContext: { kind: "occupation", occupation: "看護師" } }),
    ).toEqual({ kind: "occupation", occupation: "看護師" });
    expect(
      readPromptContext({ promptContext: { kind: "occupation", occupation: "" } }),
    ).toBeUndefined();
    expect(
      readPromptContext({
        promptContext: { kind: "weekly_rhythm", scheduleMode: "fixed_weekly" },
      }),
    ).toBeUndefined();
    expect(
      readPromptContext({
        promptContext: {
          kind: "weekly_rhythm",
          scheduleMode: "variable_shift",
          daysOff: ["sunday"],
        },
      }),
    ).toBeUndefined();
    expect(readPromptContext({ promptContext: { kind: "unknown" } })).toBeUndefined();
  });

  it("自由なkeyや不完全な属性をparseしない", () => {
    expect(parsePromptContext({ kind: "occupation" })).toBeUndefined();
    expect(
      parsePromptContext({ kind: "occupation", occupation: "看護師", inferredShift: true }),
    ).toBeUndefined();
  });

  it("曜日配列の順序だけが違う定期予定を同じ属性として扱う", () => {
    expect(
      arePromptContextsEqual(
        {
          kind: "recurring_schedule",
          activity: "塾",
          weekdays: ["monday", "wednesday"],
        },
        {
          kind: "recurring_schedule",
          activity: "塾",
          weekdays: ["wednesday", "monday"],
        },
      ),
    ).toBe(true);
  });
});
