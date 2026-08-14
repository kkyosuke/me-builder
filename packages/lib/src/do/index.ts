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
  FailedBrainVectorSyncJob,
  FailedBrainVectorSyncJobList,
} from "./account/action/brain";
export { BRAIN_VECTOR_SYNC_MAX_ATTEMPTS } from "./account/action/brain";
export {
  DIARY_BRAIN_CATEGORIES,
  DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS,
} from "./account/action/diary";
export type {
  ConversationContextMessage,
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
  findPrecedingAssistantBodies,
  isPromptContextGrounded,
  parsePromptContext,
  PROMPT_CONTEXT_ATTRIBUTE_MASTER,
  PROMPT_CONTEXT_COLLECTION_GOAL,
  PROMPT_CONTEXT_WEEKDAYS,
  PromptContextSchema,
  readPromptContext,
} from "./account/prompt-context";
export type {
  PromptContext,
  PromptContextAttributeDefinition,
  PromptContextKind,
  PromptContextPriority,
} from "./account/prompt-context";
