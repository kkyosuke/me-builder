import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";

export function isAcceptedLineRetryConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}

export function getLineDeliveryFailureKind(error: unknown): "permanent" | "transient" {
  if (typeof error !== "object" || error === null || !("status" in error)) return "transient";
  const status = error.status;
  return typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 409 &&
    status !== 429
    ? "permanent"
    : "transient";
}

/** LINEのX-Line-Retry-Keyとして使える決定的UUIDをHMACから作る。 */
export async function createLineRetryKey(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  ).slice(0, 16);
  signature[6] = ((signature[6] ?? 0) & 0x0f) | 0x40;
  signature[8] = ((signature[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * replyTokenでの返信結果。
 *
 * - `delivered`: LINEが受理した
 * - `rejected`: LINEが4xxで拒否した。到達していないことが確定しているのでpushへ回してよい
 * - `unknown`: 応答が得られず到達したか判別できない。replyTokenは一度しか使えず、
 *   同じtokenでの再送はLINE側で弾かれるため、pushへ切り替えず同じtokenで再試行する
 */
export type LineReplyOutcome = "delivered" | "rejected" | "unknown";

export async function replyLineText(input: {
  channelAccessToken: string;
  replyToken: string;
  text: string;
}): Promise<LineReplyOutcome> {
  try {
    await line.client.create(input.channelAccessToken).replyMessage({
      replyToken: input.replyToken,
      messages: [{ type: "text", text: input.text }],
    });
    return "delivered";
  } catch (error) {
    // 4xxはLINEが受け取った上で拒否した証拠なので、pushへ回しても二重にならない。
    const outcome = getLineDeliveryFailureKind(error) === "permanent" ? "rejected" : "unknown";
    logger.warn(
      { outcome, errorName: error instanceof Error ? error.name : "UnknownError" },
      "LINE reply did not succeed",
    );
    return outcome;
  }
}

export async function pushLineTextWithRetryKey(input: {
  channelAccessToken: string;
  to: string;
  text: string;
  retryKey: string;
}): Promise<void> {
  const apiClient = line.client.create(input.channelAccessToken);
  try {
    await apiClient.pushMessage(
      { to: input.to, messages: [{ type: "text", text: input.text }] },
      input.retryKey,
    );
  } catch (error) {
    // 同じretry keyが既に受理されている場合、LINEは409を返す。配送成功として扱う。
    if (isAcceptedLineRetryConflict(error)) return;
    throw error;
  }
}
