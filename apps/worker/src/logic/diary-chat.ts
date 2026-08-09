import type { ConversationContextMessage } from "@me-builder/lib";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { WorkerConfig } from "../config";
import { createGeminiClient, generateStructuredText } from "../infrastructure/gemini-client";
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
const BrainItemCandidateSchema = v.strictObject({
  category: v.literal("memory"),
  statement: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
  source_message_ids: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1))),
    v.minLength(1),
    v.maxLength(20),
  ),
  is_inference: v.literal(false),
});
const DiaryChatResponseSchema = v.strictObject({
  mode: ModeSchema,
  reply: v.pipe(v.string(), v.minLength(1), v.maxLength(5000)),
  main_question_count: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1)),
  end_session: v.boolean(),
  safety: v.strictObject({
    route: SafetyRouteSchema,
    restricted_advice: v.boolean(),
  }),
  brain_item_candidates: v.optional(v.pipe(v.array(BrainItemCandidateSchema), v.maxLength(3)), []),
});

export type DiaryChatResponse = v.InferOutput<typeof DiaryChatResponseSchema>;
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
  currentUserMessageIds: readonly string[] = [],
): DiaryChatResponse | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = v.safeParse(DiaryChatResponseSchema, json);
  if (!parsed.success) return undefined;
  const safetyRoute = stricterSafetyRoute(preclassifiedRoute, parsed.output.safety.route);
  const allowedSourceMessageIds = new Set(currentUserMessageIds);
  const brainItemCandidates =
    safetyRoute === "normal"
      ? parsed.output.brain_item_candidates.filter(({ source_message_ids: sourceMessageIds }) => {
          const uniqueIds = new Set(sourceMessageIds);
          return (
            uniqueIds.size === sourceMessageIds.length &&
            sourceMessageIds.every((id) => allowedSourceMessageIds.has(id))
          );
        })
      : [];
  return {
    ...parsed.output,
    safety: {
      route: safetyRoute,
      restricted_advice: parsed.output.safety.restricted_advice || safetyRoute !== "normal",
    },
    brain_item_candidates: brainItemCandidates,
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
    brain_item_candidates: [],
  };
}

/** ローカル開発時だけ、保存対象のBrain Itemを会話上で確認できるようにする。 */
export function appendDevelopmentBrainItemSummary(
  reply: string,
  candidates: readonly v.InferOutput<typeof BrainItemCandidateSchema>[],
  environment: string,
): string {
  if (!["dev", "development", "local"].includes(environment)) return reply;
  const summary =
    candidates.length === 0
      ? "- 追加なし"
      : candidates
          .map(
            (candidate, index) =>
              `- ${index + 1}. Memory: ${candidate.statement} (evidence: ${candidate.source_message_ids.join(", ")})`,
          )
          .join("\n");
  return `${reply}\n\n[dev] 追加したBrain Item\n${summary}`;
}

export async function generateDiaryChatResponse(
  messages: ConversationContextMessage[],
  workerConfig: WorkerConfig,
  signal?: AbortSignal,
  context?: {
    currentUserMessageIds?: string[];
    prompt?: DiaryChatPromptOptions;
  },
): Promise<DiaryChatResponse> {
  const safetyRoute = classifySafety(messages, context?.currentUserMessageIds);
  if (safetyRoute === "imminent_danger") return buildSafetyFallback(safetyRoute);
  if (!workerConfig.googleAiStudioApiKey || !workerConfig.cloudflareAiGatewayToken) {
    return buildSafetyFallback(safetyRoute);
  }

  const client = createGeminiClient({
    googleAiStudioApiKey: workerConfig.googleAiStudioApiKey,
    cloudflareAiGatewayToken: workerConfig.cloudflareAiGatewayToken,
    cloudflareAiGatewayBaseUrl: workerConfig.cloudflareAiGatewayBaseUrl,
  });
  const contents = JSON.stringify({
    context_package: {
      safety_route: safetyRoute,
      messages: messages.map(({ id, role, body }) => ({ id, role, body })),
    },
  });
  const schema = toJsonSchema(DiaryChatResponseSchema) as Record<string, unknown>;
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
    });
    const validated = raw
      ? validateDiaryChatResponse(raw, safetyRoute, context?.currentUserMessageIds)
      : undefined;
    if (validated) return validated;
  }
  return buildSafetyFallback(safetyRoute);
}
