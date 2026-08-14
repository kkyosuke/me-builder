import {
  DIARY_BRAIN_CATEGORIES,
  PromptContextSchema,
  findPrecedingAssistantBodies,
  isPromptContextGrounded,
} from "@me-builder/lib";
import type { ConversationContextMessage, DiaryBrainCategory } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { WorkerConfig } from "../config";
import {
  type GeminiUsageRecorder,
  createGeminiClient,
  generateStructuredText,
} from "../infrastructure/gemini-client";
import { DIARY_BRAIN_SYSTEM_PROMPT } from "../prompt/diary-brain";
import { classifySafety } from "./diary-chat";

const BRAIN_ITEM_NOTIFICATION_ENVIRONMENTS = new Set(["dev", "development", "local", "preview"]);

const CandidateSchema = v.strictObject({
  category: v.picklist(DIARY_BRAIN_CATEGORIES),
  statement: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
  source_message_ids: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1))),
    v.minLength(1),
    v.maxLength(20),
  ),
  is_inference: v.literal(false),
  prompt_context: v.exactOptional(PromptContextSchema),
});
const ResponseSchema = v.strictObject({
  brain_item_candidates: v.pipe(v.array(CandidateSchema), v.maxLength(3)),
});
const ResponseEnvelopeSchema = v.strictObject({
  brain_item_candidates: v.pipe(v.array(v.unknown()), v.maxLength(3)),
});

export function createDiaryBrainResponseJsonSchema(): Record<string, unknown> {
  return toJsonSchema(ResponseSchema) as Record<string, unknown>;
}

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export type DiaryBrainCandidate = v.InferOutput<typeof CandidateSchema>;

export function validateDiaryBrainCandidates(
  raw: string,
  messages: readonly ConversationContextMessage[],
  sourceMessageIds: readonly string[],
): DiaryBrainCandidate[] | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = v.safeParse(ResponseEnvelopeSchema, json);
  if (!parsed.success) return undefined;
  const allowed = new Set(sourceMessageIds);
  const sourceBodies = new Map(
    messages
      .filter(({ id, role }) => role === "user" && allowed.has(id))
      .map(({ id, body }) => [id, body]),
  );
  const accepted: DiaryBrainCandidate[] = [];
  const acceptedKeys = new Set<string>();
  for (const [candidateIndex, rawCandidate] of parsed.output.brain_item_candidates.entries()) {
    const candidateResult = v.safeParse(CandidateSchema, rawCandidate);
    if (!candidateResult.success) {
      logRejectedCandidate(candidateIndex, "schema");
      continue;
    }
    const candidate = candidateResult.output;
    const statement = candidate.statement.trim();
    if (!statement) {
      logRejectedCandidate(candidateIndex, "empty_statement");
      continue;
    }
    if (candidate.category === "identity" && candidate.prompt_context?.kind !== "occupation") {
      logRejectedCandidate(candidateIndex, "identity_without_occupation");
      continue;
    }
    if (
      candidate.prompt_context &&
      !isPromptContextGrounded(
        candidate.category,
        statement,
        candidate.prompt_context,
        findPrecedingAssistantBodies(messages, candidate.source_message_ids),
      )
    ) {
      logRejectedCandidate(candidateIndex, "ungrounded_prompt_context");
      continue;
    }
    const unique = new Set(candidate.source_message_ids);
    if (unique.size !== candidate.source_message_ids.length) {
      logRejectedCandidate(candidateIndex, "duplicate_evidence");
      continue;
    }
    if (!candidate.source_message_ids.every((id) => allowed.has(id))) {
      logRejectedCandidate(candidateIndex, "outside_checkpoint_evidence");
      continue;
    }
    const normalizedStatement = normalizeEvidenceText(statement);
    if (
      !candidate.source_message_ids.every((id) =>
        normalizeEvidenceText(sourceBodies.get(id) ?? "").includes(normalizedStatement),
      )
    ) {
      logRejectedCandidate(candidateIndex, "ungrounded_statement");
      continue;
    }
    const candidateKey = `${statement}\u0000${[...unique].sort().join("\u0000")}`;
    if (acceptedKeys.has(candidateKey)) {
      logRejectedCandidate(candidateIndex, "duplicate_candidate");
      continue;
    }
    acceptedKeys.add(candidateKey);
    accepted.push({ ...candidate, statement });
  }
  return accepted;
}

function logRejectedCandidate(candidateIndex: number, validationReason: string): void {
  logger.error({ candidateIndex, validationReason }, "Skipped invalid Diary Brain candidate");
}

export async function generateDiaryBrainCandidates(
  messages: ConversationContextMessage[],
  sourceMessageIds: readonly string[],
  workerConfig: WorkerConfig,
  onUsage?: GeminiUsageRecorder,
): Promise<DiaryBrainCandidate[] | undefined> {
  if (classifySafety(messages, [...sourceMessageIds]) !== "normal") return [];
  if (!workerConfig.googleVertexAiApiKey) {
    return ["dev", "development", "local", "test"].includes(workerConfig.environment)
      ? []
      : undefined;
  }
  const client = createGeminiClient({
    googleVertexAiApiKey: workerConfig.googleVertexAiApiKey,
  });
  const contents = JSON.stringify({
    context_package: {
      messages: messages.map(({ id, role, body }) => ({ id, role, body })),
    },
  });
  const schema = createDiaryBrainResponseJsonSchema();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await generateStructuredText(client, {
      model: workerConfig.geminiModel,
      contents,
      systemInstruction: DIARY_BRAIN_SYSTEM_PROMPT,
      responseJsonSchema: schema,
      maxOutputTokens: 1_000,
      ...(onUsage ? { onUsage } : {}),
    });
    const candidates = raw
      ? validateDiaryBrainCandidates(raw, messages, sourceMessageIds)
      : undefined;
    if (candidates) return candidates;
  }
  return undefined;
}

export function buildDevelopmentBrainItemMessage(
  candidates: readonly {
    category: DiaryBrainCategory;
    statement: string;
    sourceMessageIds: readonly string[];
    operation: "created" | "evidence_added";
    deduplication: "none" | "exact" | "semantic";
  }[],
  environment: string,
): string | undefined {
  if (!BRAIN_ITEM_NOTIFICATION_ENVIRONMENTS.has(environment)) return undefined;
  const summary =
    candidates.length === 0
      ? "- 追加なし"
      : candidates
          .map((candidate, index) => {
            const operation =
              candidate.operation === "created"
                ? "新規"
                : `Evidence追加/${candidate.deduplication}`;
            return `- ${index + 1}. [${operation}] ${candidate.category}: ${candidate.statement} (evidence: ${candidate.sourceMessageIds.join(", ")})`;
          })
          .join("\n");
  return `[dev] Brain Item反映結果\n${summary}`;
}
