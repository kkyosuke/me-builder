import {
  type BrainChatContextMemory,
  type ConversationContextMessage,
  type PromptContextCollectionCandidate,
  type PromptContextCollectionTarget,
  parsePromptContextCollectionTarget,
} from "@me-builder/lib";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { WorkerConfig } from "../config";
import {
  type GeminiUsageRecorder,
  createGeminiClient,
  generateStructuredText,
} from "../infrastructure/gemini-client";
import {
  DEFAULT_DIARY_CHAT_PROMPT_OPTIONS,
  type DiaryChatPromptOptions,
  buildDiaryChatSystemPrompt,
} from "../prompt/diary-chat";

const ModeSchema = v.picklist(["listen", "explore", "organize", "advise", "close"]);
const SafetyRouteSchema = v.picklist([
  "normal",
  "distress",
  "high_stakes",
  "self_harm_possible",
  "imminent_danger",
  "abuse_or_violence",
]);
const DiaryChatResponseSchema = v.strictObject({
  mode: ModeSchema,
  reply: v.pipe(v.string(), v.minLength(1), v.maxLength(5000)),
  main_question_count: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1)),
  end_session: v.boolean(),
  collection_theme_id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  collection_kind: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  safety: v.strictObject({
    route: SafetyRouteSchema,
    restricted_advice: v.boolean(),
  }),
  used_memory_ids: v.pipe(v.array(v.string()), v.maxLength(5)),
});
const MEMORY_STATEMENT_CHARACTER_LIMIT = 2_000;
const MEMORY_EVIDENCE_CHARACTER_LIMIT = 1_000;
const DEVELOPMENT_BRAIN_STATEMENT_CHARACTER_LIMIT = 500;
const DEVELOPMENT_BRAIN_USAGE_ENVIRONMENTS = new Set(["dev", "development", "local", "preview"]);

type RawDiaryChatResponse = v.InferOutput<typeof DiaryChatResponseSchema>;
export type DiaryChatResponse = Omit<
  RawDiaryChatResponse,
  "collection_theme_id" | "collection_kind"
> &
  Readonly<{ collection_target?: PromptContextCollectionTarget }>;
export type SafetyRoute = v.InferOutput<typeof SafetyRouteSchema>;

const routeRank: Record<SafetyRoute, number> = {
  normal: 0,
  distress: 1,
  high_stakes: 2,
  abuse_or_violence: 3,
  self_harm_possible: 4,
  imminent_danger: 5,
};

/** モデル呼び出し前の決定的な最低限の安全route。本文を保存・ログ出力しない。 */
function classifySafetyText(text: string): SafetyRoute {
  if (/(今すぐ|これから).{0,12}(死ぬ|自殺|殺す)|死ぬ準備|命の危険/u.test(text))
    return "imminent_danger";
  if (/(死にたい|消え(?:てしまい)?たい|自傷|自殺)/u.test(text)) return "self_harm_possible";
  if (/(殴られ|暴力|虐待|脅され|殺され)/u.test(text)) return "abuse_or_violence";
  if (/(診断|薬|法律|投資|借金).{0,20}(決めて|断定|絶対)/u.test(text)) return "high_stakes";
  return "normal";
}

export function classifySafety(
  messages: ConversationContextMessage[],
  currentUserMessageIds?: string[],
): SafetyRoute {
  const currentIds = currentUserMessageIds ? new Set(currentUserMessageIds) : undefined;
  const userMessages = messages.filter(
    ({ id, role }) => role === "user" && (!currentIds || currentIds.has(id)),
  );
  const scoped = currentIds
    ? userMessages
    : userMessages.length > 0
      ? [userMessages.at(-1) as ConversationContextMessage]
      : [];
  return scoped.reduce(
    (route, message) => stricterSafetyRoute(route, classifySafetyText(message.body)),
    "normal" as SafetyRoute,
  );
}

export function stricterSafetyRoute(first: SafetyRoute, second: SafetyRoute): SafetyRoute {
  return routeRank[first] >= routeRank[second] ? first : second;
}

export function validateDiaryChatResponse(
  raw: string,
  preclassifiedRoute: SafetyRoute,
  allowedMemoryIds: readonly string[] = [],
  collectionCandidates: readonly PromptContextCollectionCandidate[] = [],
): DiaryChatResponse | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = v.safeParse(DiaryChatResponseSchema, json);
  if (!parsed.success) return undefined;
  const { collection_theme_id: themeId, collection_kind: kind, ...response } = parsed.output;
  const hasNoCollectionTarget = themeId === "none" && kind === "none";
  const collectionTarget = hasNoCollectionTarget
    ? undefined
    : parsePromptContextCollectionTarget(themeId, kind);
  const safetyRoute = stricterSafetyRoute(preclassifiedRoute, parsed.output.safety.route);
  if (
    (!hasNoCollectionTarget && !collectionTarget) ||
    (collectionTarget && parsed.output.main_question_count !== 1) ||
    (collectionTarget && safetyRoute !== "normal") ||
    (collectionTarget &&
      !collectionCandidates.some(
        (candidate) =>
          candidate.themeId === collectionTarget.themeId &&
          candidate.kinds.includes(collectionTarget.kind),
      ))
  ) {
    return undefined;
  }
  const allowed = new Set(allowedMemoryIds);
  return {
    ...response,
    ...(collectionTarget ? { collection_target: collectionTarget } : {}),
    used_memory_ids: [...new Set(parsed.output.used_memory_ids)].filter((id) => allowed.has(id)),
    safety: {
      route: safetyRoute,
      restricted_advice: parsed.output.safety.restricted_advice || safetyRoute !== "normal",
    },
  };
}

export function buildSafetyFallback(route: SafetyRoute): DiaryChatResponse {
  const requiresSafetyConfirmation =
    route === "imminent_danger" || route === "self_harm_possible" || route === "abuse_or_violence";
  const reply =
    route === "imminent_danger" || route === "self_harm_possible"
      ? "話してくれてありがとう。いま一人で抱えず、まず安全な場所へ移動して、近くの信頼できる人や現地の緊急窓口に連絡してね。今この瞬間、自分を傷つける危険はある？"
      : route === "abuse_or_violence"
        ? "話してくれてありがとう。あなたの安全が最優先です。危険が迫っているなら安全な場所へ移動し、信頼できる人や現地の緊急窓口へ連絡してください。今は安全な場所にいる？"
        : "うまく返事をまとめられなかったけれど、書いてくれたことは受け取りました。今日はここに置いておくだけでも大丈夫です。";
  return {
    mode: route === "normal" ? "listen" : "organize",
    reply,
    main_question_count: requiresSafetyConfirmation ? 1 : 0,
    end_session: false,
    safety: { route, restricted_advice: route !== "normal" },
    used_memory_ids: [],
  };
}

export function buildDiaryChatContextPackage(
  messages: readonly ConversationContextMessage[],
  safetyRoute: SafetyRoute,
  brainMemories: readonly BrainChatContextMemory[] = [],
) {
  return {
    safety_route: safetyRoute,
    messages: messages.map(({ id, role, body }) => ({ id, role, body })),
    memories: brainMemories.map((memory, index) => ({
      id: `memory-${index + 1}`,
      category: memory.category,
      statement: memory.statement.slice(0, MEMORY_STATEMENT_CHARACTER_LIMIT),
      derivation: memory.derivation,
      is_inference: memory.isInference,
      status: memory.status,
      confidence: memory.confidence,
      access_labels: memory.accessLabels,
      first_observed_at: memory.firstObservedAt,
      last_observed_at: memory.lastObservedAt,
      evidence: memory.evidence.map(({ text, recordedAt }, evidenceIndex) => ({
        id: `evidence-${index + 1}-${evidenceIndex + 1}`,
        text: text.slice(0, MEMORY_EVIDENCE_CHARACTER_LIMIT),
        recorded_at: recordedAt,
      })),
    })),
  };
}

/** 開発環境だけ、モデルが実際に回答へ反映したBrain Itemの確認messageを作る。 */
export function buildDevelopmentBrainUsageMessage(
  memories: readonly Pick<BrainChatContextMemory, "category" | "statement">[],
  environment: string,
): string | undefined {
  if (memories.length === 0 || !DEVELOPMENT_BRAIN_USAGE_ENVIRONMENTS.has(environment)) {
    return undefined;
  }
  const summary = [...memories]
    .sort(
      (first, second) =>
        first.category.localeCompare(second.category) ||
        first.statement.localeCompare(second.statement),
    )
    .map(
      ({ category, statement }, index) =>
        `- ${index + 1}. ${category === "memory" ? "Memory" : category}: ${statement.slice(0, DEVELOPMENT_BRAIN_STATEMENT_CHARACTER_LIMIT)}`,
    )
    .join("\n");
  return `[dev] 使用したBrain Item\n${summary}`;
}

export async function generateDiaryChatResponse(
  messages: ConversationContextMessage[],
  workerConfig: WorkerConfig,
  signal?: AbortSignal,
  context?: {
    currentUserMessageIds?: string[];
    brainMemories?: readonly BrainChatContextMemory[];
    prompt?: DiaryChatPromptOptions;
    onUsage?: GeminiUsageRecorder;
  },
): Promise<DiaryChatResponse> {
  const safetyRoute = classifySafety(messages, context?.currentUserMessageIds);
  if (safetyRoute === "imminent_danger") return buildSafetyFallback(safetyRoute);
  if (!workerConfig.googleVertexAiApiKey) {
    return buildSafetyFallback(safetyRoute);
  }

  const client = createGeminiClient({
    googleVertexAiApiKey: workerConfig.googleVertexAiApiKey,
  });
  const brainMemories = context?.brainMemories ?? [];
  const collectionCandidates = context?.prompt?.collectionCandidates ?? [];
  const contents = JSON.stringify({
    context_package: buildDiaryChatContextPackage(messages, safetyRoute, brainMemories),
  });
  const schema = toJsonSchema(DiaryChatResponseSchema) as Record<string, unknown>;
  const allowedMemoryIds = brainMemories.map((_, index) => `memory-${index + 1}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await generateStructuredText(client, {
      model: workerConfig.geminiModel,
      contents,
      systemInstruction: buildDiaryChatSystemPrompt(
        context?.prompt ?? DEFAULT_DIARY_CHAT_PROMPT_OPTIONS,
      ),
      responseJsonSchema: schema,
      maxOutputTokens: 2_000,
      ...(signal ? { signal } : {}),
      ...(context?.onUsage ? { onUsage: context.onUsage } : {}),
    });
    const validated = raw
      ? validateDiaryChatResponse(raw, safetyRoute, allowedMemoryIds, collectionCandidates)
      : undefined;
    if (validated) return validated;
  }
  return buildSafetyFallback(safetyRoute);
}
