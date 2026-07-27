import { d1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { WorkerConfig } from "../../config";

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
      await handleTextMessage(event.replyToken, event.message.text, apiClient, workerConfig.liffId);
    }
  }
}

/**
 * LINE の userId に対応する Account を用意します。
 *
 * アカウント作成の起点は LINE 公式アカウントの友だち追加です
 * ([プロジェクト概要 §5](../../../../../docs/project-overview.md#5-アカウントと本人識別))。
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
 * トークへ送られたテキストは既定で日記として扱い、アンケートのリンクを求めるキーワードだけを
 * 例外として切り出します。LINE は日記の入力とアンケートのリンク配信を担当します
 * ([プロジェクト概要 §4](../../../../../docs/project-overview.md#4-想定する利用体験))。
 */
export type LineTextIntent = "survey-request" | "diary";

/**
 * アンケートのリンクを求めるキーワード。
 *
 * 判定は正規化後の**完全一致**で行い、部分一致は採りません。部分一致にすると
 * 「今日は会社でアンケートに答えた」のような日記本文がコマンドとして飲み込まれ、
 * 記録されるべき日記が返信だけになります。日記は蓄積の量を担う主要な入力なので、
 * 取りこぼしよりも誤判定を避ける側へ寄せます。取りこぼしは常設の導線で補います。
 */
const SURVEY_KEYWORDS = ["アンケート", "今日のアンケート", "きょうのアンケート"];

/**
 * 表記ゆれを吸収します。
 *
 * - NFKC 正規化で全角英数・半角カナ (`ｱﾝｹｰﾄ`)・全角スペースを揃える
 * - 前後の空白を落とす（コピー＆ペーストや予測変換で付きやすい）
 * - ひらがなをカタカナへ寄せて `あんけーと` を同じ表記にする
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
  const isSurveyRequest = SURVEY_KEYWORDS.some(
    (keyword) => normalizeMessageText(keyword) === normalized,
  );
  return isSurveyRequest ? "survey-request" : "diary";
}

/** 「今日のアンケート」への導線。タップすると LINE 内で Web が開きます。 */
function buildSurveyLink(liffId: string): string {
  return `今日のアンケートに答える\nhttps://liff.line.me/${liffId}`;
}

/**
 * 受信したテキストに対する返信文を組み立てます。
 *
 * - 「アンケート」と送られた場合はアンケート (LIFF) のリンクを返す
 * - それ以外（＝日記）は受け付けた旨と、あわせて「今日のアンケート」への導線を返す。
 *   日記の返信はアンケートへの主要な再訪導線なので、キーワードの追加でも変えません
 * - `LIFF_ID` 未設定時はリンクを省く（環境変数が未設定なら安全にスキップする既存方針）
 */
export function buildReplyText(messageText: string, liffId?: string): string {
  if (classifyLineText(messageText) === "survey-request") {
    if (!liffId) {
      // リンクを出せない理由は利用者に関係がないため、設定の話はせず案内だけ返します。
      return "いまはアンケートのリンクをお渡しできません。時間をおいてもう一度お試しください。";
    }
    return buildSurveyLink(liffId);
  }

  const received = "受け付けました。";
  if (!liffId) {
    return received;
  }
  return `${received}\n${buildSurveyLink(liffId)}`;
}

async function handleTextMessage(
  replyToken: string,
  messageText: string,
  apiClient: ReturnType<typeof line.client.create>,
  liffId?: string,
): Promise<void> {
  try {
    await apiClient.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: buildReplyText(messageText, liffId),
        },
      ],
    });
    logger.info(
      // 本文は日記そのものなのでログへ出さず、判定結果だけを残します。
      { replyToken, intent: classifyLineText(messageText), hasLiffLink: Boolean(liffId) },
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
