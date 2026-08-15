import type { SafeOperationalErrorFields } from "./operational-error";

/** 処理の最終結果。終端ログ1件が必ずこのいずれかを持つ。 */
export type OperationalOutcome = "succeeded" | "degraded" | "deferred" | "discarded" | "failed";

/** 処理境界がQueue messageをどう手放したか。 */
export type QueueDisposition = "ack" | "retry" | "dead-letter" | "platform-retry";

/**
 * 終端ログのmessage文言に使う人間向けの処理名。
 * ログ一覧を上から読むときの見出しになるため、componentごとに1つだけ定義する。
 */
export const FLOW_LABEL = {
  "line-webhook": "LINE webhook",
  "chat-turn": "Chat turn",
  "diary-brain-checkpoint": "Diary Brain checkpoint",
  "brain-vector-sync": "Brain vector sync",
  "profile-summary-generation": "Profile summary generation",
  "daily-prompt": "Daily prompt",
  billing: "Billing projection",
  "queue-dispatch": "Queue dispatch",
} as const;

export type FlowKey = keyof typeof FLOW_LABEL;

export type QueueMessageResultDescription = {
  flow: FlowKey;
  outcome: OperationalOutcome;
  disposition: QueueDisposition;
  /** 結果が確定した工程。例: "line.reply" */
  stage: string;
  attempt: number;
  /** 初回配送を含む最大試行回数。次の失敗でDLQへ落ちるかを読み取れるようにする。 */
  maxAttempts?: number | undefined;
  durationMs?: number | undefined;
  resultCode?: string | undefined;
  error?: SafeOperationalErrorFields | undefined;
};

/**
 * 「どの処理が」「どの工程で」「どうなり」「次にどうなるか」を1行で表すmessageを組み立てます。
 * 構造化フィールドと同じ情報から機械的に作ることで、call siteごとに文言が分かれないようにします。
 */
export function describeQueueMessageResult(result: QueueMessageResultDescription): string {
  const details = [
    `attempt ${result.attempt}${result.maxAttempts ? `/${result.maxAttempts}` : ""}`,
    ...(result.durationMs === undefined ? [] : [`${result.durationMs}ms`]),
    ...(result.resultCode ? [result.resultCode] : []),
    ...(result.error ? [result.error.errorCode, `category:${result.error.errorCategory}`] : []),
    ...(result.error?.dependency
      ? [
          result.error.dependencyStatus === undefined
            ? `via:${result.error.dependency}`
            : `via:${result.error.dependency} ${result.error.dependencyStatus}`,
        ]
      : []),
  ];
  return `[${FLOW_LABEL[result.flow]}] ${result.outcome} at ${result.stage} -> ${result.disposition} (${details.join(", ")})`;
}

/** HTTPの終端ログmessage。Queueの終端ログと同じ読み方ができる形に揃えます。 */
export function describeHttpResult(result: {
  service: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode?: string | undefined;
}): string {
  const details = [`${result.durationMs}ms`, ...(result.errorCode ? [result.errorCode] : [])];
  return `[${result.service}] ${result.method} ${result.path} -> ${result.status} (${details.join(", ")})`;
}

/**
 * HTTP statusを結果へ写します。
 * 4xxは利用者側の入力や認可で終わった結果、5xxはサーバー側の失敗として扱います。
 */
export function httpOutcome(status: number): OperationalOutcome {
  if (status >= 500) return "failed";
  if (status >= 400) return "discarded";
  return "succeeded";
}

/** 結果から出力レベルを決めます。成功だけをinfoにし、通常時のinfoを異常で埋めません。 */
export function operationalLogLevel(
  outcome: OperationalOutcome,
  hasError = false,
): "info" | "warn" | "error" {
  if (outcome === "failed" || hasError) return "error";
  return outcome === "succeeded" ? "info" : "warn";
}
