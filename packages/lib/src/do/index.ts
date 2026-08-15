import * as accountAction from "./account/action";
import { type AccountDataDatabase, accountSchema } from "./account/database";

/**
 * Durable Objectが保存するdatabase。
 *
 * `account`は1 AccountのSource / Brain / Diary / Diagnosis回答のSSoT。
 * 境界は`docs/architecture/account-data-isolation.md`を正とする。
 */
const account = {
  action: accountAction,
  schema: accountSchema,
};

export const DO = { account };

export namespace DO {
  export namespace account {
    export type Database = AccountDataDatabase;
  }
}

export { accountSchema } from "./account/database";
export * from "./account/rpc";
export type {
  ActiveBrainVectorEntry,
  AppliedBrainVectorSync,
  BrainChatContextMemory,
  BrainSemanticDedupCandidate,
  DailyPromptWeekdayContext,
  FailedBrainVectorSyncJob,
  FailedBrainVectorSyncJobList,
  RelationshipDiagnosisContext,
} from "./account/action/brain";
export { BRAIN_VECTOR_SYNC_MAX_ATTEMPTS } from "./account/action/brain";
export { expireAiUsageReservations } from "./account/action/ai-usage";
export type { UtsushiProgression } from "./account/action/progression";
export {
  chooseDailyPromptLocalHour,
  chooseDailyPromptStrategy,
  DAILY_PROMPT_STANDARD_BASELINE_OPPORTUNITIES,
  DAILY_PROMPT_STRATEGY_INITIAL_OPPORTUNITIES,
  DAILY_PROMPT_STRATEGY_METRIC_WINDOW,
  DAILY_PROMPT_TIME_INITIAL_OPPORTUNITIES,
  DIARY_BRAIN_CATEGORIES,
  DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS,
} from "./account/action/diary";
export type {
  ConversationContextMessage,
  DailyPromptFollowUp,
  DailyPromptPreviousDayContext,
  DailyPromptSameDayContext,
  DailyPromptSchedule,
  DailyPromptSelectionSource,
  DailyPromptStrategyStat,
  DailyPromptTimeStat,
  DiaryBrainCategory,
  DiaryBrainCheckpointCandidate,
} from "./account/action/diary";
export {
  buildDiaryTemporalSearchText,
  DIARY_BRAIN_TIME_ZONE,
  readDiaryTemporalContext,
  resolveDiaryTemporalContext,
} from "./account/action/diary-temporal";
export type {
  DiaryTemporalContext,
  DiaryTemporalResolution,
} from "./account/action/diary-temporal";
export {
  arePromptContextsEqual,
  buildPromptContextCollectionCandidates,
  dailyPromptLocalHourFromRestWindow,
  dailyPromptStrategyFromQuestionStyle,
  DAILY_PROMPT_LOCAL_HOURS,
  DAILY_PROMPT_STRATEGIES,
  findPrecedingAssistantBodies,
  isPromptContextGrounded,
  parsePromptContext,
  parsePromptContextCollectionTarget,
  PROMPT_CONTEXT_ATTRIBUTE_MASTER,
  PROMPT_CONTEXT_COLLECTION_GOAL,
  PROMPT_CONTEXT_COLLECTION_THEME_MASTER,
  PROMPT_CONTEXT_WEEKDAYS,
  PromptContextSchema,
  readPromptContext,
} from "./account/prompt-context";
export type {
  DailyPromptLocalHour,
  DailyPromptStrategy,
  PromptContext,
  PromptContextAttributeDefinition,
  PromptContextCollectionCandidate,
  PromptContextCollectionThemeDefinition,
  PromptContextCollectionThemeId,
  PromptContextCollectionTarget,
  PromptContextKind,
  PromptContextPriority,
  PromptContextWeekday,
} from "./account/prompt-context";
