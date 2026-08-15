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

export type PromptContextWeekday = (typeof PROMPT_CONTEXT_WEEKDAYS)[number];

const WeekdaySchema = v.picklist(PROMPT_CONTEXT_WEEKDAYS);

const OccupationPromptContextSchema = v.strictObject({
  kind: v.literal("occupation"),
  occupation: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
});

const WeeklyRhythmPromptContextSchema = v.strictObject({
  kind: v.literal("weekly_rhythm"),
  scheduleMode: v.picklist(["fixed_weekly", "variable_shift", "irregular"]),
  activeWeekdays: v.exactOptional(v.pipe(v.array(WeekdaySchema), v.minLength(1), v.maxLength(7))),
  daysOff: v.exactOptional(v.pipe(v.array(WeekdaySchema), v.minLength(1), v.maxLength(7))),
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

export const DAILY_PROMPT_STRATEGIES = [
  "standard",
  "brief",
  "event_first",
  "feeling_first",
] as const;

export type DailyPromptStrategy = (typeof DAILY_PROMPT_STRATEGIES)[number];

export const DAILY_PROMPT_LOCAL_HOURS = [18, 20, 21] as const;
export type DailyPromptLocalHour = (typeof DAILY_PROMPT_LOCAL_HOURS)[number];

/** 本人が明言した聞かれ方を、レビュー済みの日次声かけ方針へ閉じ込める。 */
export function dailyPromptStrategyFromQuestionStyle(
  style: Extract<PromptContext, { kind: "question_style" }>["style"],
): DailyPromptStrategy {
  return style === "no_choices" ? "standard" : style;
}

/** 生活上の区切りや明言時刻を、許可済みの夕方以降の候補へ写像する。 */
export function dailyPromptLocalHourFromRestWindow(
  restWindow: Extract<PromptContext, { kind: "rest_window" }>,
): DailyPromptLocalHour | undefined {
  if (restWindow.window === "after_dinner") return 21;
  if (restWindow.window === "after_returning_home" || restWindow.window === "evening") return 20;
  if (restWindow.window !== "fixed_time" || !restWindow.localTime) return undefined;
  const [hourText, minuteText] = restWindow.localTime.split(":");
  const minutes = Number(hourText) * 60 + Number(minuteText);
  if (!Number.isFinite(minutes) || minutes < 17 * 60 || minutes > 22 * 60) return undefined;
  return DAILY_PROMPT_LOCAL_HOURS.reduce((closest, candidate) =>
    Math.abs(candidate * 60 - minutes) < Math.abs(closest * 60 - minutes) ? candidate : closest,
  );
}

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

export type PromptContextCollectionThemeDefinition = Readonly<{
  id: string;
  kinds: readonly PromptContextKind[];
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

/** 確認質問を同じ会話の流れで扱える属性へまとめた収集テーマ。 */
export const PROMPT_CONTEXT_COLLECTION_THEME_MASTER = [
  {
    id: "life_schedule",
    kinds: ["occupation", "weekly_rhythm", "recurring_schedule"],
    description: "仕事・学校など今の立場から、週間リズムや曜日別予定へつながるテーマ",
  },
  {
    id: "conversation_preference",
    kinds: ["rest_window", "question_style"],
    description: "一息つきやすい時間と、返信しやすい聞かれ方を扱うテーマ",
  },
] as const satisfies readonly PromptContextCollectionThemeDefinition[];

export type PromptContextCollectionThemeId =
  (typeof PROMPT_CONTEXT_COLLECTION_THEME_MASTER)[number]["id"];

export type PromptContextCollectionTarget = Readonly<{
  themeId: PromptContextCollectionThemeId;
  kind: PromptContextKind;
}>;

export type PromptContextCollectionCandidate = Readonly<{
  themeId: PromptContextCollectionThemeId;
  kinds: readonly PromptContextKind[];
  remainingQuestionCount: number;
}>;

/** 未取得欄の達成率を作らず、会話を優先して属性を集めるための目標設定。 */
export const PROMPT_CONTEXT_COLLECTION_GOAL = {
  prioritizedThemeIds: PROMPT_CONTEXT_COLLECTION_THEME_MASTER.map(({ id }) => id),
  maxCollectionThemesPerSession: 1,
  maxConfirmationQuestionsPerTheme: 2,
  requireCompletion: false,
  retryUnanswered: false,
  extractionMode: "explicit_only",
} as const;

const COLLECTION_THEME_BY_ID = new Map(
  PROMPT_CONTEXT_COLLECTION_THEME_MASTER.map((theme) => [theme.id, theme]),
);

/** 永続化した文字列を、マスタ上で同じテーマに属する収集対象だけへ絞る。 */
export function parsePromptContextCollectionTarget(
  themeId: unknown,
  kind: unknown,
): PromptContextCollectionTarget | undefined {
  if (typeof themeId !== "string" || typeof kind !== "string") return undefined;
  const theme = COLLECTION_THEME_BY_ID.get(themeId as PromptContextCollectionThemeId);
  if (!theme || !theme.kinds.some((candidateKind) => candidateKind === kind)) return undefined;
  return { themeId: theme.id, kind: kind as PromptContextKind };
}

/**
 * 保存済み属性とSession内の質問履歴から、モデルへ提示できる収集候補を返す。
 * 実際に質問するかと、現在の会話に自然につながる候補の選択はモデルが判断する。
 */
export function buildPromptContextCollectionCandidates(input: {
  collectedKinds: readonly PromptContextKind[];
  askedTargets: readonly PromptContextCollectionTarget[];
}): readonly PromptContextCollectionCandidate[] {
  const askedThemeIds = [...new Set(input.askedTargets.map(({ themeId }) => themeId))];
  if (
    input.askedTargets.length >= PROMPT_CONTEXT_COLLECTION_GOAL.maxConfirmationQuestionsPerTheme ||
    askedThemeIds.length > PROMPT_CONTEXT_COLLECTION_GOAL.maxCollectionThemesPerSession
  ) {
    return [];
  }

  const allowedThemeIds =
    askedThemeIds.length > 0 ? askedThemeIds : PROMPT_CONTEXT_COLLECTION_GOAL.prioritizedThemeIds;
  const collectedKinds = new Set(input.collectedKinds);
  const askedKinds = new Set(input.askedTargets.map(({ kind }) => kind));
  const remainingQuestionCount =
    PROMPT_CONTEXT_COLLECTION_GOAL.maxConfirmationQuestionsPerTheme - input.askedTargets.length;

  return allowedThemeIds.flatMap((themeId) => {
    const theme = COLLECTION_THEME_BY_ID.get(themeId);
    if (!theme) return [];
    const kinds = theme.kinds.filter(
      (kind) =>
        !collectedKinds.has(kind) &&
        (PROMPT_CONTEXT_COLLECTION_GOAL.retryUnanswered || !askedKinds.has(kind)),
    );
    return kinds.length > 0 ? [{ themeId, kinds, remainingQuestionCount }] : [];
  });
}

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

const THIRD_PARTY_SUBJECT =
  /娘|息子|友達|友人|知人|夫|妻|母|父|子ども|子供|その子|彼氏|彼女|彼|その人|あの人|相手|家族|兄|姉|弟|妹|同僚|上司|部下/u;

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
  if (THIRD_PARTY_SUBJECT.test(question)) return false;
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
  if (
    THIRD_PARTY_SUBJECT.test(occupation) ||
    /^(?:私は|自分は|仕事は|職業は|普段は|今は)/u.test(occupation) ||
    /(?:(?:なの|なんだ|です|でした|だ|だよ)|として働いている|の仕事をしている)(?:[。.!！])?$/u.test(
      occupation,
    )
  ) {
    return false;
  }
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

function hasWeekdayEvidence(
  statement: string,
  weekday: (typeof PROMPT_CONTEXT_WEEKDAYS)[number],
): boolean {
  if (["monday", "tuesday", "wednesday", "thursday", "friday"].includes(weekday)) {
    if (/平日/u.test(statement)) return true;
  }
  if (weekday === "saturday" || weekday === "sunday") {
    if (/土日|週末/u.test(statement)) return true;
  }
  return WEEKDAY_EVIDENCE[weekday].test(statement);
}

function hasUniqueWeekdays(
  weekdays: readonly (typeof PROMPT_CONTEXT_WEEKDAYS)[number][] | undefined,
): boolean {
  return !weekdays || new Set(weekdays).size === weekdays.length;
}

function isWeeklyRhythmGrounded(
  statement: string,
  promptContext: Extract<PromptContext, { kind: "weekly_rhythm" }>,
): boolean {
  const hasWeekendsOff =
    !/(?:土日|週末).{0,8}(?:休み.{0,4}(?:ではない|じゃない|でない|ではありません|じゃありません)|休まない|休めない)/u.test(
      statement,
    ) && /(?:土日|週末).{0,8}(?:休み|休む|休業|休日)/u.test(statement);
  const nonFixedSchedule =
    /固定.{0,8}(?:ではない|じゃない|でない|ではありません|じゃありません|されていない|されてない|されてません|じゃなく)|曜日.{0,8}(?:決まっていない|決まってない|決まってません|決まらない)/u.test(
      statement,
    );
  const irregularSchedule = /不規則|ばらばら|バラバラ|日によって.{0,8}(?:違う|変わる)/u.test(
    statement,
  );
  const activeWeekdays = promptContext.activeWeekdays;
  const daysOff = promptContext.daysOff;
  if (!hasUniqueWeekdays(activeWeekdays) || !hasUniqueWeekdays(daysOff)) return false;
  if (activeWeekdays?.some((weekday) => daysOff?.includes(weekday))) return false;
  switch (promptContext.scheduleMode) {
    case "fixed_weekly": {
      if (nonFixedSchedule || irregularSchedule || (!activeWeekdays && !daysOff)) return false;
      const hasFixedCycle = /固定|毎週|曜日.{0,8}決ま|平日|土日|週末/u.test(statement);
      const activeWeekdaysAreGrounded =
        !activeWeekdays ||
        (/(?:働|勤務|仕事|稼働|出社|可動)/u.test(statement) &&
          activeWeekdays.every((weekday) => hasWeekdayEvidence(statement, weekday)));
      const daysOffAreGrounded =
        !daysOff ||
        (/(?:休み|休む|休業|休日|固定休)/u.test(statement) &&
          daysOff.every((weekday) => hasWeekdayEvidence(statement, weekday)) &&
          (!(daysOff.includes("saturday") && daysOff.includes("sunday")) || hasWeekendsOff));
      return hasFixedCycle && activeWeekdaysAreGrounded && daysOffAreGrounded;
    }
    case "variable_shift":
      return (
        (!activeWeekdays &&
          !daysOff &&
          !irregularSchedule &&
          /不定休|休み.{0,10}(?:決まっていない|決まってない|決まってません|変わる|一定じゃない)/u.test(
            statement,
          )) ||
        (!activeWeekdays && !daysOff && !irregularSchedule && nonFixedSchedule) ||
        (!activeWeekdays &&
          !daysOff &&
          !irregularSchedule &&
          /シフト/u.test(statement) &&
          /休み|勤務|仕事|働|予定|曜日/u.test(statement))
      );
    case "irregular":
      return (
        !activeWeekdays &&
        !daysOff &&
        irregularSchedule &&
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
      return isWeeklyRhythmGrounded(statement, promptContext);
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
      return (
        right.kind === "weekly_rhythm" &&
        left.scheduleMode === right.scheduleMode &&
        [...(left.activeWeekdays ?? [])].sort().join("\0") ===
          [...(right.activeWeekdays ?? [])].sort().join("\0") &&
        [...(left.daysOff ?? [])].sort().join("\0") === [...(right.daysOff ?? [])].sort().join("\0")
      );
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
  if (!parsed.success) return undefined;
  if (parsed.output.kind !== "weekly_rhythm") return parsed.output;
  const { activeWeekdays, daysOff, scheduleMode } = parsed.output;
  if (!hasUniqueWeekdays(activeWeekdays) || !hasUniqueWeekdays(daysOff)) return undefined;
  if (activeWeekdays?.some((weekday) => daysOff?.includes(weekday))) return undefined;
  if (scheduleMode === "fixed_weekly") {
    return activeWeekdays || daysOff ? parsed.output : undefined;
  }
  return activeWeekdays || daysOff ? undefined : parsed.output;
}

/** 永続化済みattributesを信頼せず、検証済みの声かけ属性だけを読む。 */
export function readPromptContext(attributes: unknown): PromptContext | undefined {
  if (!attributes || typeof attributes !== "object" || !("promptContext" in attributes)) {
    return undefined;
  }
  return parsePromptContext(attributes.promptContext);
}
