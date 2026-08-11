export const DIARY_BRAIN_TIME_ZONE = "Asia/Tokyo";

export type DiaryTemporalResolution = Readonly<{
  original: string;
  resolved: string;
}>;

export type DiaryTemporalContext = Readonly<{
  originalStatement: string;
  anchorDate: string;
  timeZone: typeof DIARY_BRAIN_TIME_ZONE;
  resolutions: readonly DiaryTemporalResolution[];
}>;

type CalendarDate = Readonly<{ year: number; month: number; day: number }>;

function calendarDateInDiaryTimeZone(at: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DIARY_BRAIN_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function shiftCalendarMonth(date: CalendarDate, offset: number): CalendarDate {
  const zeroBased = date.year * 12 + date.month - 1 + offset;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
    day: date.day,
  };
}

function shiftCalendarDay(date: CalendarDate, offset: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatCalendarMonth(date: CalendarDate): string {
  return `${date.year}年${date.month}月`;
}

function formatCalendarDate(date: CalendarDate): string {
  return `${formatCalendarMonth(date)}${date.day}日`;
}

/**
 * 日本語の固有名詞を相対日付と誤認しないため、語の直後が日付として自然な場合だけ解決する。
 * 判断に迷う表現は原文のままに倒し、Brain Itemの命題自体は常に変更しない。
 */
function hasTemporalRightBoundary(statement: string, end: number): boolean {
  const suffix = statement.slice(end);
  if (suffix.length === 0) return true;
  return /^(?:[\s\p{P}\p{S}\d０-９]|は|が|を|に|で|と|の|へ|も|から|まで|より|頃|ごろ|中|末|初め|以降|以前|以後|時点|予定)/u.test(
    suffix,
  );
}

/** 相対日付を発言時点の日本時間で解決し、原文とは別の時点情報として返す。 */
export function resolveDiaryTemporalContext(
  originalStatement: string,
  recordedAt: Date,
): DiaryTemporalContext | undefined {
  const anchor = calendarDateInDiaryTimeZone(recordedAt);
  const candidates: readonly DiaryTemporalResolution[] = [
    { original: "再来月", resolved: formatCalendarMonth(shiftCalendarMonth(anchor, 2)) },
    { original: "来月", resolved: formatCalendarMonth(shiftCalendarMonth(anchor, 1)) },
    { original: "今月", resolved: formatCalendarMonth(anchor) },
    { original: "先月", resolved: formatCalendarMonth(shiftCalendarMonth(anchor, -1)) },
    { original: "再来年", resolved: `${anchor.year + 2}年` },
    { original: "来年", resolved: `${anchor.year + 1}年` },
    { original: "今年", resolved: `${anchor.year}年` },
    { original: "去年", resolved: `${anchor.year - 1}年` },
    { original: "一昨日", resolved: formatCalendarDate(shiftCalendarDay(anchor, -2)) },
    { original: "昨日", resolved: formatCalendarDate(shiftCalendarDay(anchor, -1)) },
    { original: "今日", resolved: formatCalendarDate(anchor) },
    { original: "明後日", resolved: formatCalendarDate(shiftCalendarDay(anchor, 2)) },
    { original: "明日", resolved: formatCalendarDate(shiftCalendarDay(anchor, 1)) },
  ];
  const occupied: Array<Readonly<{ start: number; end: number }>> = [];
  const resolutions: DiaryTemporalResolution[] = [];

  for (const candidate of candidates) {
    let from = 0;
    while (from < originalStatement.length) {
      const start = originalStatement.indexOf(candidate.original, from);
      if (start < 0) break;
      const end = start + candidate.original.length;
      const overlaps = occupied.some((range) => start < range.end && end > range.start);
      if (!overlaps && hasTemporalRightBoundary(originalStatement, end)) {
        resolutions.push(candidate);
        occupied.push({ start, end });
        break;
      }
      from = end;
    }
  }

  if (resolutions.length === 0) return undefined;
  return {
    originalStatement,
    anchorDate: `${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`,
    timeZone: DIARY_BRAIN_TIME_ZONE,
    resolutions,
  };
}

/** 原文を保ったまま、embeddingにだけ絶対日付の検索手掛かりを追加する。 */
export function buildDiaryTemporalSearchText(
  statement: string,
  temporalContext?: DiaryTemporalContext,
): string {
  if (!temporalContext) return statement;
  const supplement = temporalContext.resolutions
    .map(({ original, resolved }) => `${original} = ${resolved}`)
    .join("、");
  return `${statement}\n時点情報: ${supplement}`;
}

/** 永続化済みのJSON属性を信頼せず、Vector同期に利用できる時点情報だけを読む。 */
export function readDiaryTemporalContext(attributes: unknown): DiaryTemporalContext | undefined {
  if (!attributes || typeof attributes !== "object" || !("temporalContext" in attributes)) {
    return undefined;
  }
  const context = attributes.temporalContext;
  if (!context || typeof context !== "object") return undefined;
  const candidate = context as Record<string, unknown>;
  if (
    typeof candidate.originalStatement !== "string" ||
    typeof candidate.anchorDate !== "string" ||
    candidate.timeZone !== DIARY_BRAIN_TIME_ZONE ||
    !Array.isArray(candidate.resolutions)
  ) {
    return undefined;
  }
  const resolutions = candidate.resolutions.filter((value): value is DiaryTemporalResolution =>
    Boolean(
      value &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).original === "string" &&
        typeof (value as Record<string, unknown>).resolved === "string",
    ),
  );
  if (resolutions.length === 0 || resolutions.length !== candidate.resolutions.length) {
    return undefined;
  }
  return {
    originalStatement: candidate.originalStatement,
    anchorDate: candidate.anchorDate,
    timeZone: DIARY_BRAIN_TIME_ZONE,
    resolutions,
  };
}
