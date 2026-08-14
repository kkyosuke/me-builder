import * as v from "valibot";

export const PROMPT_CONTEXT_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const WeekdaySchema = v.picklist(PROMPT_CONTEXT_WEEKDAYS);

const OccupationPromptContextSchema = v.strictObject({
  kind: v.literal("occupation"),
  occupation: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
});

const WeeklyRhythmPromptContextSchema = v.strictObject({
  kind: v.literal("weekly_rhythm"),
  scheduleMode: v.picklist([
    "weekends_off",
    "weekdays_active_weekends_off",
    "fixed_weekly",
    "variable_shift",
    "irregular",
  ]),
});

const RecurringSchedulePromptContextSchema = v.strictObject({
  kind: v.literal("recurring_schedule"),
  activity: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  weekdays: v.pipe(v.array(WeekdaySchema), v.minLength(1), v.maxLength(7)),
});

const RestWindowPromptContextSchema = v.strictObject({
  kind: v.literal("rest_window"),
  window: v.picklist(["after_returning_home", "after_dinner", "evening", "variable", "fixed_time"]),
  localTime: v.exactOptional(v.pipe(v.string(), v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))),
});

const QuestionStylePromptContextSchema = v.strictObject({
  kind: v.literal("question_style"),
  style: v.picklist(["brief", "event_first", "feeling_first", "no_choices"]),
});

/** Brain Itemのattributes.promptContextへ保存できる構造のSSoT。 */
export const PromptContextSchema = v.variant("kind", [
  OccupationPromptContextSchema,
  WeeklyRhythmPromptContextSchema,
  RecurringSchedulePromptContextSchema,
  RestWindowPromptContextSchema,
  QuestionStylePromptContextSchema,
]);

export type PromptContext = v.InferOutput<typeof PromptContextSchema>;
export type PromptContextKind = PromptContext["kind"];
export type PromptContextPriority = "high" | "medium" | "low";

export type PromptContextAttributeDefinition = Readonly<{
  kind: PromptContextKind;
  category: "identity" | "behavior_pattern" | "preference";
  priority: PromptContextPriority;
  description: string;
}>;

/**
 * 保存対象属性の初期マスタ。
 *
 * 表示用プロフィールの必須項目ではなく、自然な声かけへ使えるBrain Itemの抽出候補を定義する。
 */
export const PROMPT_CONTEXT_ATTRIBUTE_MASTER = [
  {
    kind: "occupation",
    category: "identity",
    priority: "high",
    description: "本人が明言した現在の立場や職業",
  },
  {
    kind: "weekly_rhythm",
    category: "behavior_pattern",
    priority: "high",
    description: "土日休み、平日中心、固定曜日、シフト制など本人が明言した週間リズム",
  },
  {
    kind: "recurring_schedule",
    category: "behavior_pattern",
    priority: "high",
    description: "塾、部活、出社、習い事など本人が繰り返すと明言した曜日別予定",
  },
  {
    kind: "rest_window",
    category: "preference",
    priority: "high",
    description: "帰宅後、夕食後など本人が明言した一息つきやすい時間",
  },
  {
    kind: "question_style",
    category: "preference",
    priority: "high",
    description: "出来事から、気分から、ひとことなど本人が明言した聞かれ方の好み",
  },
] as const satisfies readonly PromptContextAttributeDefinition[];

/** 未取得欄の達成率を作らず、会話を優先して属性を集めるための目標設定。 */
export const PROMPT_CONTEXT_COLLECTION_GOAL = {
  prioritizedKinds: PROMPT_CONTEXT_ATTRIBUTE_MASTER.map(({ kind }) => kind),
  maxAttributeGroupsPerSession: 1,
  maxConfirmationQuestionsPerGroup: 2,
  requireCompletion: false,
  retryUnanswered: false,
  extractionMode: "explicit_only",
} as const;

const DEFINITION_BY_KIND = new Map(
  PROMPT_CONTEXT_ATTRIBUTE_MASTER.map((definition) => [definition.kind, definition]),
);

const WEEKDAY_EVIDENCE: Readonly<Record<(typeof PROMPT_CONTEXT_WEEKDAYS)[number], RegExp>> = {
  monday: /月曜(?:日)?|毎月曜/u,
  tuesday: /火曜(?:日)?|毎火曜/u,
  wednesday: /水曜(?:日)?|毎水曜/u,
  thursday: /木曜(?:日)?|毎木曜/u,
  friday: /金曜(?:日)?|毎金曜/u,
  saturday: /土曜(?:日)?|毎土曜/u,
  sunday: /日曜(?:日)?|毎日曜/u,
};

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

type PromptContextConversationMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  body: string;
  sequence: number;
}>;

/** Evidenceのuser messageに直接先行するassistant messageだけを補助文脈として返す。 */
export function findPrecedingAssistantBodies(
  messages: readonly PromptContextConversationMessage[],
  sourceMessageIds: readonly string[],
): readonly string[] {
  const sourceIds = new Set(sourceMessageIds);
  const sourceSequences = new Set(
    messages
      .filter(({ id, role }) => role === "user" && sourceIds.has(id))
      .map(({ sequence }) => sequence),
  );
  return [
    ...new Set(
      messages
        .filter(({ role, sequence }) => role === "assistant" && sourceSequences.has(sequence + 1))
        .map(({ body }) => body),
    ),
  ];
}

function isSelfOccupationQuestion(value: string): boolean {
  const question = normalize(value);
  if (
    /娘|息子|友達|夫|妻|母|父|子ども|子供|その子|彼氏|彼女|その人|あの人|相手|家族|兄|姉|弟|妹|同僚/u.test(
      question,
    )
  ) {
    return false;
  }
  return (
    /(?:どんな|何の|なんの).{0,8}(?:仕事|職業|立場)/u.test(question) ||
    /(?:仕事|職業|立場).{0,8}(?:何|なに|どんな)/u.test(question) ||
    /(?:学生|会社員|自営業)(?:なの|ですか|なのか|[?？])/u.test(question)
  );
}

function isOccupationGrounded(
  statement: string,
  occupationInput: string,
  precedingAssistantBodies: readonly string[],
): boolean {
  const occupation = normalize(occupationInput);
  if (/(?:なの|なんだ|です|だよ)$/u.test(occupation)) return false;
  if (statement === occupation) {
    return precedingAssistantBodies.some(isSelfOccupationQuestion);
  }
  const index = statement.indexOf(occupation);
  if (index < 0) return false;
  const before = statement.slice(0, index);
  const after = statement.slice(index + occupation.length);
  const hasSelfSubject =
    before.length === 0 || /(?:私は|自分は|仕事は|職業は|普段は|今は)$/u.test(before);
  const hasOccupationPredicate =
    (after.length === 0 && before.length > 0) ||
    /^(?:なの|なんだ|です|だよ|だ$|として|をして|で働|の仕事をして)/u.test(after);
  return hasSelfSubject && hasOccupationPredicate;
}

function isWeeklyRhythmGrounded(
  statement: string,
  scheduleMode: Extract<PromptContext, { kind: "weekly_rhythm" }>["scheduleMode"],
): boolean {
  const hasWeekendsOff =
    !/(?:土日|週末).{0,8}(?:休み.{0,4}(?:ではない|じゃない|でない|ではありません|じゃありません)|休まない|休めない)/u.test(
      statement,
    ) && /(?:土日|週末).{0,8}(?:休み|休む|休業|休日)/u.test(statement);
  const nonFixedSchedule =
    /固定.{0,8}(?:ではない|じゃない|でない|ではありません|じゃありません|されていない|されてない|されてません|じゃなく)|曜日.{0,8}(?:決まっていない|決まってない|決まってません|決まらない)/u.test(
      statement,
    );
  switch (scheduleMode) {
    case "weekends_off":
      return hasWeekendsOff;
    case "weekdays_active_weekends_off":
      return /平日.{0,8}(?:働|勤務|仕事|稼働|出社)/u.test(statement) && hasWeekendsOff;
    case "fixed_weekly": {
      if (nonFixedSchedule) return false;
      return (
        /固定|曜日.{0,8}決ま/u.test(statement) && /休み|勤務|仕事|働|予定|曜日/u.test(statement)
      );
    }
    case "variable_shift":
      return (
        /不定休|休み.{0,10}(?:決まっていない|決まってない|決まってません|変わる|一定じゃない)/u.test(
          statement,
        ) ||
        nonFixedSchedule ||
        (/シフト/u.test(statement) && /休み|勤務|仕事|働|予定|曜日/u.test(statement))
      );
    case "irregular":
      return (
        /不規則|ばらばら|バラバラ|日によって.{0,8}(?:違う|変わる)/u.test(statement) &&
        /休み|勤務|仕事|働|予定|曜日|生活/u.test(statement)
      );
  }
}

function hasLocalTimeEvidence(statement: string, localTime: string | undefined): boolean {
  if (!localTime) return false;
  const [hour, minute] = localTime.split(":");
  if (!hour || !minute) return false;
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const alternatives = [
    localTime,
    `${hourNumber}時${minuteNumber === 0 ? "" : `${minuteNumber}分`}`,
  ];
  return alternatives.some((value) => statement.includes(value));
}

/** 構造化属性が許可categoryと本人の命題に裏づけられているかを決定的に検証する。 */
export function isPromptContextGrounded(
  category: string,
  statementInput: string,
  promptContext: PromptContext,
  precedingAssistantBodies: readonly string[] = [],
): boolean {
  const definition = DEFINITION_BY_KIND.get(promptContext.kind);
  if (!definition || definition.category !== category) return false;
  const statement = normalize(statementInput);
  switch (promptContext.kind) {
    case "occupation":
      return isOccupationGrounded(statement, promptContext.occupation, precedingAssistantBodies);
    case "weekly_rhythm":
      return isWeeklyRhythmGrounded(statement, promptContext.scheduleMode);
    case "recurring_schedule": {
      if (!statement.includes(normalize(promptContext.activity))) return false;
      if (!/毎週|いつも|普段|毎[月火水木金土日]曜/u.test(statement)) return false;
      if (/娘|息子|友達|夫|妻|母|父|子ども|子供|彼氏|彼女/u.test(statement)) return false;
      return (
        new Set(promptContext.weekdays).size === promptContext.weekdays.length &&
        promptContext.weekdays.every((weekday) => WEEKDAY_EVIDENCE[weekday].test(statement))
      );
    }
    case "rest_window": {
      if (!/落ち着|一息|返しやす|話しやす|時間がある|余裕/u.test(statement)) return false;
      if (promptContext.window === "fixed_time") {
        return hasLocalTimeEvidence(statement, promptContext.localTime);
      }
      if (promptContext.localTime) return false;
      const patterns = {
        after_returning_home: /帰宅後|家に着いてから|帰ってから/u,
        after_dinner: /夕食後|晩ごはんの後|ご飯を食べてから/u,
        evening: /夕方|夜/u,
        variable: /日による|日によって|決まっていない|決まってない|ばらばら|バラバラ/u,
      } as const;
      return patterns[promptContext.window].test(statement);
    }
    case "question_style": {
      if (!/答えやす|聞いてほしい|聞かれる方|がいい|ほしい|好き|苦手/u.test(statement)) {
        return false;
      }
      const patterns = {
        brief: /ひとこと|一言|短く|短い|簡単/u,
        event_first: /出来事|何があった/u,
        feeling_first: /気分|気持ち|感情/u,
        no_choices: /選択肢.{0,8}(?:いらない|不要|なし|ない)|自由に/u,
      } as const;
      return patterns[promptContext.style].test(statement);
    }
  }
}

/** 配列順など意味を変えない表現差を除いて、2つの構造化属性が同じか判定する。 */
export function arePromptContextsEqual(left: PromptContext, right: PromptContext): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "occupation":
      return (
        right.kind === "occupation" && normalize(left.occupation) === normalize(right.occupation)
      );
    case "weekly_rhythm":
      return right.kind === "weekly_rhythm" && left.scheduleMode === right.scheduleMode;
    case "recurring_schedule":
      return (
        right.kind === "recurring_schedule" &&
        normalize(left.activity) === normalize(right.activity) &&
        [...left.weekdays].sort().join("\0") === [...right.weekdays].sort().join("\0")
      );
    case "rest_window":
      return (
        right.kind === "rest_window" &&
        left.window === right.window &&
        left.localTime === right.localTime
      );
    case "question_style":
      return right.kind === "question_style" && left.style === right.style;
  }
}

/** 永続化済みattributesを信頼せず、検証済みの声かけ属性だけを読む。 */
export function parsePromptContext(value: unknown): PromptContext | undefined {
  const parsed = v.safeParse(PromptContextSchema, value);
  return parsed.success ? parsed.output : undefined;
}

/** 永続化済みattributesを信頼せず、検証済みの声かけ属性だけを読む。 */
export function readPromptContext(attributes: unknown): PromptContext | undefined {
  if (!attributes || typeof attributes !== "object" || !("promptContext" in attributes)) {
    return undefined;
  }
  return parsePromptContext(attributes.promptContext);
}
