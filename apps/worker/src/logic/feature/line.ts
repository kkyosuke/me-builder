import { d1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { WorkerConfig } from "../../config";
import { createGeminiClient, generateText } from "../../infrastructure/gemini-client";

type GenerateAiText = (prompt: string) => Promise<string | undefined>;

export async function processLineWebhook(
  payload: unknown,
  db: d1.Client,
  workerConfig?: WorkerConfig,
): Promise<void> {
  if (!workerConfig?.lineChannelAccessToken) {
    logger.warn("[LINE Reply] LINE_CHANNEL_ACCESS_TOKEN is not configured.");
    return;
  }

  const events = line.webhook.parseEvents(payload);
  const apiClient = line.client.create(workerConfig.lineChannelAccessToken);

  for (const event of events) {
    const providerAccountId = event.source?.userId;

    // 1. followイベント時はユーザー情報をUpsertする
    if (event.type === "follow") {
      await ensureAccountIdentity(db, providerAccountId, "follow");
      continue;
    }

    // 2. messageイベント時の処理
    if (event.type === "message" && event.message.type === "text" && event.replyToken) {
      // メッセージが届いている = 友だちである証明なので、follow イベントを取り逃していても
      // ここで Account を補完する。友だち追加より前から利用しているユーザーや、
      // follow イベントの処理に失敗したユーザーが Web 側で本人確認できなくなるのを防ぐ。
      await ensureAccountIdentity(db, providerAccountId, "message");
      await handleTextMessage(event.replyToken, event.message.text, apiClient, workerConfig);
    }
  }
}

/**
 * LINE の userId に対応する Account を用意します。
 *
 * アカウント作成の起点は LINE 公式アカウントの友だち追加です
 * ([プロジェクト概要 §5](../../../../../docs/product/project-overview.md#5-アカウントと本人識別))。
 * follow イベントと、友だちであることが確かなメッセージ受信時のみ呼び出します。
 *
 * 失敗しても返信は行うため、例外は握りつぶしてログだけ残します。
 */
async function ensureAccountIdentity(
  db: d1.Client,
  providerAccountId: string | undefined,
  trigger: "follow" | "message",
): Promise<void> {
  if (!providerAccountId) {
    return;
  }

  try {
    await d1.action.account.upsertIdentity(db, { provider: "line", providerAccountId });
    logger.info({ trigger }, "[LINE Webhook] Account identity ensured");
  } catch (err) {
    logger.error({ err, trigger }, "[LINE Webhook] Failed to ensure account identity");
  }
}

/**
 * テキストメッセージの意図。
 *
 * トークへ送られたテキストは既定で日記として扱い、診断のリンクを求めるキーワードと
 * 明示的な `AI:` 接続確認だけを例外として切り出します。LINE は日記の入力と診断のリンク配信を担当します
 * ([プロジェクト概要 §4](../../../../../docs/product/project-overview.md#4-想定する利用体験))。
 */
export type LineTextIntent = "diagnosis-request" | "ai-chat" | "diary";

/**
 * 診断のリンクを求めるキーワード。
 *
 * 判定は正規化後の**完全一致**で行い、部分一致は採りません。部分一致にすると
 * 「今日は会社で診断に答えた」のような日記本文がコマンドとして飲み込まれ、
 * 記録されるべき日記が返信だけになります。日記は蓄積の量を担う主要な入力なので、
 * 取りこぼしよりも誤判定を避ける側へ寄せます。取りこぼしは常設の導線で補います。
 */
const DIAGNOSIS_KEYWORDS = [
  "診断",
  "しんだん",
  "今日の診断",
  "今日のしんだん",
  "きょうの診断",
  "きょうのしんだん",
];

/**
 * 表記ゆれを吸収します。
 *
 * - NFKC 正規化で全角英数・全角スペースを揃える
 * - 前後の空白を落とす（コピー＆ペーストや予測変換で付きやすい）
 * - ひらがなをカタカナへ寄せて `しんだん` の表記ゆれを揃える
 */
function normalizeMessageText(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
}

/** テキストメッセージの意図を判定します。 */
export function classifyLineText(text: string): LineTextIntent {
  const normalized = normalizeMessageText(text);
  const isDiagnosisRequest = DIAGNOSIS_KEYWORDS.some(
    (keyword) => normalizeMessageText(keyword) === normalized,
  );
  if (isDiagnosisRequest) {
    return "diagnosis-request";
  }
  return extractAiPrompt(text) === undefined ? "diary" : "ai-chat";
}

/** `AI: 質問` 形式の接続確認メッセージから、Geminiへ渡す質問だけを取り出します。 */
export function extractAiPrompt(text: string): string | undefined {
  const match = text.trim().match(/^ai\s*[:：]\s*(.*)$/is);
  return match?.[1]?.trim();
}

/** 「今日の診断」への導線。タップすると LINE 内で Web が開きます。 */
function buildDiagnosisLink(liffId: string): string {
  return `今日の診断に答える\nhttps://liff.line.me/${liffId}`;
}

/**
 * 受信したテキストに対する返信文を組み立てます。
 *
 * - 「診断」と送られた場合は診断 (LIFF) のリンクを返す
 * - それ以外（＝日記）は受け付けた旨と、あわせて「今日の診断」への導線を返す。
 *   日記の返信は診断への主要な再訪導線なので、キーワードの追加でも変えません
 * - `LIFF_ID` 未設定時はリンクを省く（環境変数が未設定なら安全にスキップする既存方針）
 */
export function buildReplyText(messageText: string, liffId?: string): string {
  if (classifyLineText(messageText) === "diagnosis-request") {
    if (!liffId) {
      // リンクを出せない理由は利用者に関係がないため、設定の話はせず案内だけ返します。
      return "いまは診断のリンクをお渡しできません。時間をおいてもう一度お試しください。";
    }
    return buildDiagnosisLink(liffId);
  }

  if (classifyLineText(messageText) === "ai-chat") {
    return extractAiPrompt(messageText)
      ? "いまはAIに接続できません。時間をおいてもう一度お試しください。"
      : "`AI:` の後に質問を入力してください。";
  }

  const received = "受け付けました。";
  if (!liffId) {
    return received;
  }
  return `${received}\n${buildDiagnosisLink(liffId)}`;
}

const LINE_TEXT_MESSAGE_MAX_LENGTH = 5000;

/** Geminiの応答をLINEのテキスト上限に収めます。 */
export function buildAiReplyText(generatedText: string): string | undefined {
  const text = generatedText.trim();
  if (!text) {
    return undefined;
  }

  const truncated = text.slice(0, LINE_TEXT_MESSAGE_MAX_LENGTH);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

function createAiTextGenerator(workerConfig: WorkerConfig): GenerateAiText | undefined {
  if (!workerConfig.googleAiStudioApiKey || !workerConfig.cloudflareAiGatewayToken) {
    return undefined;
  }

  const client = createGeminiClient({
    googleAiStudioApiKey: workerConfig.googleAiStudioApiKey,
    cloudflareAiGatewayToken: workerConfig.cloudflareAiGatewayToken,
    cloudflareAiGatewayBaseUrl: workerConfig.cloudflareAiGatewayBaseUrl,
  });
  return (prompt) => generateText(client, workerConfig.geminiModel, prompt);
}

function getMissingAiConfiguration(workerConfig: WorkerConfig): string[] {
  const missingConfiguration: string[] = [];
  if (!workerConfig.googleAiStudioApiKey) {
    missingConfiguration.push("GOOGLE_AI_STUDIO_API_KEY");
  }
  if (!workerConfig.cloudflareAiGatewayToken) {
    missingConfiguration.push("CLOUDFLARE_AIG_TOKEN");
  }
  return missingConfiguration;
}

function redactKnownSecrets(message: string, secrets: Array<string | undefined>): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
  }
  return redacted;
}

function buildAiErrorLogContext(error: unknown, workerConfig: WorkerConfig) {
  const errorRecord =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errorMessage = redactKnownSecrets(rawMessage, [
    workerConfig.googleAiStudioApiKey,
    workerConfig.cloudflareAiGatewayToken,
  ]);

  return {
    provider: "google-ai-studio",
    gateway: "cloudflare-ai-gateway",
    model: workerConfig.geminiModel,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage,
    errorStatus: errorRecord?.status ?? errorRecord?.statusCode,
    errorCode: errorRecord?.code,
  };
}

async function handleTextMessage(
  replyToken: string,
  messageText: string,
  apiClient: ReturnType<typeof line.client.create>,
  workerConfig: WorkerConfig,
): Promise<void> {
  const intent = classifyLineText(messageText);
  let replyText = buildReplyText(messageText, workerConfig.liffId);
  let aiResponded = false;

  if (intent === "ai-chat") {
    const prompt = extractAiPrompt(messageText);
    if (prompt) {
      const missingConfiguration = getMissingAiConfiguration(workerConfig);
      const generateAiText = createAiTextGenerator(workerConfig);

      if (!generateAiText) {
        logger.error(
          {
            provider: "google-ai-studio",
            gateway: "cloudflare-ai-gateway",
            model: workerConfig.geminiModel,
            reason: "missing_configuration",
            missingConfiguration,
          },
          "[Gemini] AI connection is not configured",
        );
      } else {
        const startedAt = Date.now();
        try {
          const generatedText = await generateAiText(prompt);
          const aiReplyText = generatedText ? buildAiReplyText(generatedText) : undefined;
          if (aiReplyText) {
            replyText = aiReplyText;
            aiResponded = true;
          } else {
            logger.warn(
              {
                provider: "google-ai-studio",
                gateway: "cloudflare-ai-gateway",
                model: workerConfig.geminiModel,
                reason: "empty_response",
                durationMs: Date.now() - startedAt,
              },
              "[Gemini] AI request returned an empty response",
            );
          }
        } catch (error) {
          logger.error(
            {
              ...buildAiErrorLogContext(error, workerConfig),
              reason: "api_error",
              durationMs: Date.now() - startedAt,
            },
            "[Gemini] Failed to generate a LINE reply",
          );
        }
      }
    }
  }

  try {
    await apiClient.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: replyText,
        },
      ],
    });
    logger.info(
      // 本文は日記そのものなのでログへ出さず、判定結果だけを残します。
      { replyToken, intent, hasLiffLink: Boolean(workerConfig.liffId), aiResponded },
      "[LINE Reply] Reply sent successfully via LINE Messaging API",
    );
  } catch (error) {
    logger.error(
      {
        replyToken,
        error: error instanceof Error ? error.message : String(error),
      },
      "[LINE Reply] Failed to send reply message via LINE Messaging API",
    );
  }
}
