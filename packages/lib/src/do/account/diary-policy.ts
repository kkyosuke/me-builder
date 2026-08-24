import {
  DAILY_PROMPT_LOCAL_HOURS,
  DAILY_PROMPT_STRATEGIES,
  type DailyPromptLocalHour,
  type DailyPromptStrategy,
} from "./prompt-context";

const CONVERSATION_POLICY_EXPLORATION_RATE = 0.2;
export const DAILY_PROMPT_STRATEGY_METRIC_WINDOW = 90;
export const DAILY_PROMPT_STANDARD_BASELINE_OPPORTUNITIES = 3;
export const DAILY_PROMPT_STRATEGY_INITIAL_OPPORTUNITIES = 2;
const DAILY_PROMPT_STRATEGY_EXPLORATION_RATE = 0.2;
export const DAILY_PROMPT_TIME_INITIAL_OPPORTUNITIES = 2;
const DAILY_PROMPT_TIME_EXPLORATION_RATE = 0.2;

export type ConversationPolicyStat = {
  policyId: string;
  replyOpportunityCount: number;
  replyCount: number;
};

export type DailyPromptSelectionSource = "explicit" | "learned" | "fallback";

export type DailyPromptStrategyStat = Readonly<{
  promptStrategy: DailyPromptStrategy;
  deliveryOpportunityCount: number;
  responseCount: number;
  stopCount: number;
}>;

export type DailyPromptTimeStat = Readonly<{
  localHour: DailyPromptLocalHour;
  deliveryOpportunityCount: number;
  responseCount: number;
  stopCount: number;
}>;

export type DailyPromptSchedule = Readonly<{
  selectedLocalHour: DailyPromptLocalHour;
  selectionSource: DailyPromptSelectionSource;
}>;

function randomItem<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  if (item === undefined) throw new Error("Cannot select an item from an empty list");
  return item;
}

/** 未試行方針と探索を優先し、それ以外では本人の返信率が最も高い方針を選ぶ。 */
export function chooseConversationPolicyId(
  policyIds: readonly string[],
  stats: readonly ConversationPolicyStat[],
  random: () => number = Math.random,
): string {
  if (policyIds.length === 0 || new Set(policyIds).size !== policyIds.length) {
    throw new Error("Conversation policy IDs must be a non-empty unique list");
  }
  const statsByPolicyId = new Map(stats.map((stat) => [stat.policyId, stat]));
  const untried = policyIds.filter(
    (policyId) => (statsByPolicyId.get(policyId)?.replyOpportunityCount ?? 0) === 0,
  );
  if (untried.length > 0) return randomItem(untried, random);
  if (random() < CONVERSATION_POLICY_EXPLORATION_RATE) return randomItem(policyIds, random);

  const highestReplyRate = Math.max(
    ...policyIds.map((policyId) => {
      const stat = statsByPolicyId.get(policyId);
      return stat ? stat.replyCount / stat.replyOpportunityCount : 0;
    }),
  );
  const bestPolicyIds = policyIds.filter((policyId) => {
    const stat = statsByPolicyId.get(policyId);
    return stat ? stat.replyCount / stat.replyOpportunityCount === highestReplyRate : false;
  });
  return randomItem(bestPolicyIds, random);
}

function dailyPromptOutcomeScore(
  stat: Pick<DailyPromptStrategyStat, "deliveryOpportunityCount" | "responseCount" | "stopCount">,
): number {
  if (stat.deliveryOpportunityCount === 0) return Number.NEGATIVE_INFINITY;
  return (stat.responseCount - 2 * stat.stopCount) / stat.deliveryOpportunityCount;
}

/** 標準観測と各候補の初期観測後、本人内の結果だけで活用と探索を選ぶ。 */
export function chooseDailyPromptStrategy(
  stats: readonly DailyPromptStrategyStat[],
  random: () => number = Math.random,
): DailyPromptStrategy {
  const statsByStrategy = new Map(stats.map((stat) => [stat.promptStrategy, stat]));
  const standardOpportunities = statsByStrategy.get("standard")?.deliveryOpportunityCount ?? 0;
  if (standardOpportunities < DAILY_PROMPT_STANDARD_BASELINE_OPPORTUNITIES) return "standard";

  const alternatives = DAILY_PROMPT_STRATEGIES.filter((strategy) => strategy !== "standard");
  const underObserved = alternatives.filter(
    (strategy) =>
      (statsByStrategy.get(strategy)?.deliveryOpportunityCount ?? 0) <
      DAILY_PROMPT_STRATEGY_INITIAL_OPPORTUNITIES,
  );
  if (underObserved.length > 0) {
    const fewestOpportunities = Math.min(
      ...underObserved.map(
        (strategy) => statsByStrategy.get(strategy)?.deliveryOpportunityCount ?? 0,
      ),
    );
    const nextStrategies = underObserved.filter(
      (strategy) =>
        (statsByStrategy.get(strategy)?.deliveryOpportunityCount ?? 0) === fewestOpportunities,
    );
    return randomItem(nextStrategies, random);
  }

  if (random() < DAILY_PROMPT_STRATEGY_EXPLORATION_RATE) {
    return randomItem(DAILY_PROMPT_STRATEGIES, random);
  }
  const highestScore = Math.max(
    ...DAILY_PROMPT_STRATEGIES.map((strategy) => {
      const stat = statsByStrategy.get(strategy);
      return stat ? dailyPromptOutcomeScore(stat) : Number.NEGATIVE_INFINITY;
    }),
  );
  const bestStrategies = DAILY_PROMPT_STRATEGIES.filter((strategy) => {
    const stat = statsByStrategy.get(strategy);
    return stat ? dailyPromptOutcomeScore(stat) === highestScore : false;
  });
  return randomItem(bestStrategies, random);
}

function hasCompletedDailyPromptStrategyCalibration(
  stats: readonly DailyPromptStrategyStat[],
  fixedPromptStrategy?: DailyPromptStrategy,
): boolean {
  const statsByStrategy = new Map(stats.map((stat) => [stat.promptStrategy, stat]));
  if (fixedPromptStrategy) {
    return (
      (statsByStrategy.get(fixedPromptStrategy)?.deliveryOpportunityCount ?? 0) >=
      DAILY_PROMPT_STANDARD_BASELINE_OPPORTUNITIES
    );
  }
  return DAILY_PROMPT_STRATEGIES.every(
    (strategy) =>
      (statsByStrategy.get(strategy)?.deliveryOpportunityCount ?? 0) >=
      (strategy === "standard"
        ? DAILY_PROMPT_STANDARD_BASELINE_OPPORTUNITIES
        : DAILY_PROMPT_STRATEGY_INITIAL_OPPORTUNITIES),
  );
}

/** 方針の初期観測を終えてから、本人内の結果だけで時刻の活用と探索を選ぶ。 */
export function chooseDailyPromptLocalHour(
  timeStats: readonly DailyPromptTimeStat[],
  strategyStats: readonly DailyPromptStrategyStat[],
  random: () => number = Math.random,
  fixedPromptStrategy?: DailyPromptStrategy,
): DailyPromptLocalHour {
  if (!hasCompletedDailyPromptStrategyCalibration(strategyStats, fixedPromptStrategy)) return 18;

  const statsByHour = new Map(timeStats.map((stat) => [stat.localHour, stat]));
  const baselineOpportunities = statsByHour.get(18)?.deliveryOpportunityCount ?? 0;
  if (baselineOpportunities < DAILY_PROMPT_STANDARD_BASELINE_OPPORTUNITIES) return 18;

  const alternatives = DAILY_PROMPT_LOCAL_HOURS.filter((localHour) => localHour !== 18);
  const underObserved = alternatives.filter(
    (localHour) =>
      (statsByHour.get(localHour)?.deliveryOpportunityCount ?? 0) <
      DAILY_PROMPT_TIME_INITIAL_OPPORTUNITIES,
  );
  if (underObserved.length > 0) {
    const fewestOpportunities = Math.min(
      ...underObserved.map(
        (localHour) => statsByHour.get(localHour)?.deliveryOpportunityCount ?? 0,
      ),
    );
    return randomItem(
      underObserved.filter(
        (localHour) =>
          (statsByHour.get(localHour)?.deliveryOpportunityCount ?? 0) === fewestOpportunities,
      ),
      random,
    );
  }

  if (random() < DAILY_PROMPT_TIME_EXPLORATION_RATE) {
    return randomItem(DAILY_PROMPT_LOCAL_HOURS, random);
  }
  const highestScore = Math.max(
    ...DAILY_PROMPT_LOCAL_HOURS.map((localHour) => {
      const stat = statsByHour.get(localHour);
      return stat ? dailyPromptOutcomeScore(stat) : Number.NEGATIVE_INFINITY;
    }),
  );
  return randomItem(
    DAILY_PROMPT_LOCAL_HOURS.filter((localHour) => {
      const stat = statsByHour.get(localHour);
      return stat ? dailyPromptOutcomeScore(stat) === highestScore : false;
    }),
    random,
  );
}
