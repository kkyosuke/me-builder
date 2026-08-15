import type {
  BrainChatContextMemory,
  ConversationContextMessage,
  RelationshipDiagnosisContext,
} from "@me-builder/lib";
import type { RelationshipCategory } from "@me-builder/lib/diagnosis";

export type RelationshipQuestionContextMode =
  | "current-message"
  | "session-and-diagnosis"
  | "confirmed-history";

export type RelationshipQuestionContext = Readonly<{
  accountId: string;
  mode: RelationshipQuestionContextMode;
  personReferenceStatus: "confirmed" | "needs-confirmation";
  personReference?: string;
  category?: RelationshipCategory;
  diagnoses: readonly RelationshipDiagnosisContext[];
}>;

const CATEGORY_SIGNALS: Readonly<Record<Exclude<RelationshipCategory, "general">, RegExp>> = {
  partner: /(夫|妻|彼氏|彼女|恋人|パートナー|配偶者|婚約者|partner|spouse)/iu,
  family: /(母|父|両親|親|兄|姉|弟|妹|祖父|祖母|家族|息子|娘|子ども|子供|きょうだい|family)/iu,
  friend: /(友達|友だち|友人|親友|幼なじみ|friend)/iu,
  work: /(上司|部下|同僚|先輩|後輩|取引先|職場|会社|仕事仲間|coworker|colleague|boss)/iu,
};
const RELATIONSHIP_SIGNALS =
  /(相手|あの人|その人|人間関係|関係性|仲直り|喧嘩|けんか|口論|揉め|気まず|すれ違)/u;
const EXPLICIT_PERSON_SIGNALS =
  /(夫|妻|彼氏|彼女|恋人|パートナー|配偶者|婚約者|母|父|兄|姉|弟|妹|祖父|祖母|息子|娘|友達|友だち|友人|親友|上司|部下|同僚|先輩|後輩|取引先|仕事仲間)/u;
const NAMED_PERSON_SIGNAL =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,20}(?:さん|くん|君|ちゃん|氏)/u;
const FULL_HISTORY_CATEGORIES = new Set(["memory", "goal"]);

function currentUserMessages(
  messages: readonly ConversationContextMessage[],
  currentUserMessageIds: readonly string[],
): readonly ConversationContextMessage[] {
  const currentIds = new Set(currentUserMessageIds);
  return messages.filter(({ id, role }) => role === "user" && currentIds.has(id));
}

function detectCategory(text: string): RelationshipCategory | undefined {
  const detected = Object.entries(CATEGORY_SIGNALS).flatMap(([category, pattern]) =>
    pattern.test(text) ? [category as Exclude<RelationshipCategory, "general">] : [],
  );
  return detected.length === 1 ? detected[0] : undefined;
}

function detectSafePersonReference(text: string): string | undefined {
  return text.match(EXPLICIT_PERSON_SIGNALS)?.[0];
}

/** Fullでも安定した人物IDがない固有名の履歴は使わず、同じ役割が明示された本人記録だけへ縮める。 */
export function selectFullRelationshipHistory(
  context: RelationshipQuestionContext,
  memories: readonly BrainChatContextMemory[],
): readonly BrainChatContextMemory[] {
  if (context.mode !== "confirmed-history" || !context.personReference) return [];
  return memories.filter(
    (memory) =>
      FULL_HISTORY_CATEGORIES.has(memory.category) &&
      !memory.isInference &&
      memory.evidence.length > 0 &&
      !NAMED_PERSON_SIGNAL.test(memory.statement) &&
      memory.statement.includes(context.personReference as string),
  );
}

/**
 * 関係性の話題だけをPlan別の最小Contextへ縮める。
 * Lite段階では第三者データを受け取っても本人所有の関連診断以外は通さない。
 */
export function buildRelationshipQuestionPlan(
  input: Readonly<{
    accountId: string;
    mode: RelationshipQuestionContextMode;
    messages: readonly ConversationContextMessage[];
    currentUserMessageIds: readonly string[];
    diagnoses?: readonly RelationshipDiagnosisContext[];
  }>,
):
  | Readonly<{ active: false; messages: readonly ConversationContextMessage[] }>
  | Readonly<{
      active: true;
      messages: readonly ConversationContextMessage[];
      context: RelationshipQuestionContext;
    }> {
  const current = currentUserMessages(input.messages, input.currentUserMessageIds);
  const currentText = current.map(({ body }) => body).join("\n");
  const category = detectCategory(currentText);
  const personReference = detectSafePersonReference(currentText);
  const active =
    EXPLICIT_PERSON_SIGNALS.test(currentText) || RELATIONSHIP_SIGNALS.test(currentText);
  if (!active) return { active: false, messages: input.messages };

  const messages = input.mode === "current-message" ? current : input.messages;
  const diagnoses =
    input.mode === "current-message" || !category
      ? []
      : (input.diagnoses ?? []).filter(
          ({ ownerAccountId, relationshipCategory }) =>
            ownerAccountId === input.accountId &&
            (relationshipCategory === category || relationshipCategory === "general"),
        );
  return {
    active: true,
    messages,
    context: {
      accountId: input.accountId,
      mode: input.mode,
      personReferenceStatus: EXPLICIT_PERSON_SIGNALS.test(currentText)
        ? "confirmed"
        : "needs-confirmation",
      ...(personReference ? { personReference } : {}),
      ...(category ? { category } : {}),
      diagnoses,
    },
  };
}
