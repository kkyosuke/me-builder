import type {
  BrainChatContextMemory,
  ConversationContextMessage,
  RelationshipDiagnosisContext,
} from "@me-builder/lib";
import type { RelationshipCategory } from "@me-builder/lib/diagnosis";
import type { SharedRelationshipContext } from "./shared-relationship-context";

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
  sharedRelationships: readonly SharedRelationshipContext[];
  matchedSharedRelationship?: SharedRelationshipContext;
}>;

const CATEGORY_REFERENCE_TERMS: Readonly<
  Record<Exclude<RelationshipCategory, "general">, readonly string[]>
> = {
  partner: ["夫", "妻", "彼氏", "彼女", "恋人", "パートナー", "配偶者", "婚約者"],
  family: [
    "母",
    "父",
    "両親",
    "親",
    "兄",
    "姉",
    "弟",
    "妹",
    "祖父",
    "祖母",
    "家族",
    "息子",
    "娘",
    "子ども",
    "子供",
    "きょうだい",
  ],
  friend: ["友達", "友だち", "友人", "親友", "幼なじみ"],
  work: ["上司", "部下", "同僚", "先輩", "後輩", "取引先", "職場", "仕事仲間"],
};
const CATEGORY_SIGNALS: Readonly<Record<Exclude<RelationshipCategory, "general">, RegExp>> = {
  partner: /(夫|妻|彼氏|彼女|恋人|パートナー|配偶者|婚約者|partner|spouse)/iu,
  family:
    /(母|父|両親|親(?!友)|兄|姉|弟|妹|祖父|祖母|家族|息子|娘|子ども|子供|きょうだい|family)/iu,
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

function detectCategories(text: string): readonly RelationshipCategory[] {
  return Object.entries(CATEGORY_SIGNALS).flatMap(([category, pattern]) =>
    pattern.test(text) ? [category as Exclude<RelationshipCategory, "general">] : [],
  );
}

function detectSafePersonReference(text: string): string | undefined {
  return text.match(EXPLICIT_PERSON_SIGNALS)?.[0];
}

function includesCategoryReference(statement: string, term: string): boolean {
  return term === "親" ? /親(?!友)/u.test(statement) : statement.includes(term);
}

function detectSharedRelationship(
  text: string,
  categories: readonly RelationshipCategory[],
  sharedRelationships: readonly SharedRelationshipContext[],
):
  | Readonly<{ status: "matched"; relationship: SharedRelationshipContext }>
  | Readonly<{ status: "ambiguous" | "none" }> {
  const named = sharedRelationships.filter(({ partnerDisplayName }) =>
    text.includes(partnerDisplayName),
  );
  if (named.length > 0) {
    if (categories.length > 1) return { status: "ambiguous" };
    const category = categories[0];
    const compatible = category
      ? named.filter(({ relationshipCategory }) => relationshipCategory === category)
      : named;
    return compatible.length === 1
      ? { status: "matched", relationship: compatible[0] as SharedRelationshipContext }
      : { status: "ambiguous" };
  }
  if (categories.length > 1) return { status: "ambiguous" };
  const category = categories[0];
  if (!category || category === "general") return { status: "none" };
  const categorized = sharedRelationships.filter(
    ({ relationshipCategory }) => relationshipCategory === category,
  );
  if (categorized.length === 1) {
    return {
      status: "matched",
      relationship: categorized[0] as SharedRelationshipContext,
    };
  }
  return { status: categorized.length > 1 ? "ambiguous" : "none" };
}

/** 現在発言と一意に照合できた共有相手だけをVector検索hintへ加える。 */
export function buildRelationshipSearchHints(
  context: RelationshipQuestionContext,
): readonly string[] {
  if (context.personReferenceStatus !== "confirmed") return [];
  const matched = context.matchedSharedRelationship;
  if (!matched) return context.personReference ? [context.personReference] : [];
  return [
    matched.partnerDisplayName,
    matched.relationshipCategory,
    ...(context.personReference ? [context.personReference] : []),
  ];
}

/** Fullでも共有相手か同じ役割に照合できない人物履歴は使わず、本人所有の確認済み記録だけへ縮める。 */
export function selectFullRelationshipHistory(
  context: RelationshipQuestionContext,
  memories: readonly BrainChatContextMemory[],
): readonly BrainChatContextMemory[] {
  if (
    context.mode !== "confirmed-history" ||
    context.personReferenceStatus !== "confirmed" ||
    !context.personReference
  ) {
    return [];
  }
  const matched = context.matchedSharedRelationship;
  return memories.filter((memory) => {
    if (
      !FULL_HISTORY_CATEGORIES.has(memory.category) ||
      memory.isInference ||
      memory.evidence.length === 0
    ) {
      return false;
    }
    if (!matched) {
      return (
        !NAMED_PERSON_SIGNAL.test(memory.statement) &&
        memory.statement.includes(context.personReference as string)
      );
    }
    const hasOtherSharedName = context.sharedRelationships.some(
      ({ relationshipCategory, partnerDisplayName }) =>
        (relationshipCategory !== matched.relationshipCategory ||
          partnerDisplayName !== matched.partnerDisplayName) &&
        memory.statement.includes(partnerDisplayName),
    );
    if (hasOtherSharedName) return false;
    if (memory.statement.includes(matched.partnerDisplayName)) return true;
    if (NAMED_PERSON_SIGNAL.test(memory.statement)) return false;
    return CATEGORY_REFERENCE_TERMS[matched.relationshipCategory].some((term) =>
      includesCategoryReference(memory.statement, term),
    );
  });
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
    sharedRelationships?: readonly SharedRelationshipContext[];
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
  const sharedRelationships = input.sharedRelationships ?? [];
  const detectedCategories = detectCategories(currentText);
  const detectedCategory = detectedCategories.length === 1 ? detectedCategories[0] : undefined;
  const sharedRelationshipMatch = detectSharedRelationship(
    currentText,
    detectedCategories,
    sharedRelationships,
  );
  const matchedSharedRelationship =
    sharedRelationshipMatch.status === "matched" ? sharedRelationshipMatch.relationship : undefined;
  const category = detectedCategory ?? matchedSharedRelationship?.relationshipCategory;
  const personReference =
    detectSafePersonReference(currentText) ??
    (matchedSharedRelationship && currentText.includes(matchedSharedRelationship.partnerDisplayName)
      ? matchedSharedRelationship.partnerDisplayName
      : undefined);
  const active =
    EXPLICIT_PERSON_SIGNALS.test(currentText) ||
    RELATIONSHIP_SIGNALS.test(currentText) ||
    Boolean(matchedSharedRelationship && personReference);
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
      personReferenceStatus:
        sharedRelationshipMatch.status === "ambiguous"
          ? "needs-confirmation"
          : EXPLICIT_PERSON_SIGNALS.test(currentText) || personReference
            ? "confirmed"
            : "needs-confirmation",
      ...(personReference ? { personReference } : {}),
      ...(category ? { category } : {}),
      diagnoses,
      sharedRelationships,
      ...(matchedSharedRelationship ? { matchedSharedRelationship } : {}),
    },
  };
}
