import { logger } from "@me-builder/shared";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { LiffSessionState } from "../model/types";
import { getLiffIdToken } from "./liff-client";

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type LiffSessionRequest =
  operations["verifyLiffSession"]["requestBody"]["content"]["application/json"];

/** IDトークンをAPIへ送り、サーバー側で本人性を検証してAccountを解決させる。 */
export async function verifyLiffSession(apiUrl: string | undefined): Promise<LiffSessionState> {
  const token = getLiffIdToken();

  if (!token) {
    logger.warn("ID トークンが取得できません。LIFF アプリの openid スコープを確認してください");
    return {
      status: "error",
      message: "ID トークンを取得できませんでした（LIFF アプリの openid スコープが必要です）",
    };
  }

  try {
    const body: LiffSessionRequest = { idToken: token };
    const response = await createHttpClient(apiUrl).request("/api/line/liff/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.status === 404) {
      logger.info("LINE Login の識別子に対応する Account がありません");
      return { status: "friendship-required" };
    }
    if (!response.ok) {
      logger.warn(`ID トークンの検証に失敗しました (HTTP ${response.status})`);
      return { status: "error", message: `本人確認に失敗しました (HTTP ${response.status})` };
    }

    logger.info("ID トークンの検証に成功しました");
    return { status: "verified" };
  } catch (error) {
    logger.warn(`ID トークンの検証リクエストに失敗しました: ${toMessage(error)}`);
    return { status: "error", message: "本人確認のリクエストに失敗しました" };
  }
}
