import { describe, expect, it } from "vitest";
import {
  describeHttpResult,
  describeQueueMessageResult,
  httpOutcome,
  operationalLogLevel,
} from "./operational-log";

describe("describeQueueMessageResult", () => {
  it("成功したmessageは処理名、工程、ack、試行回数を1行で表す", () => {
    expect(
      describeQueueMessageResult({
        flow: "line-webhook",
        outcome: "succeeded",
        disposition: "ack",
        stage: "chat.accept",
        attempt: 1,
        maxAttempts: 4,
        durationMs: 412,
      }),
    ).toBe("[LINE webhook] succeeded at chat.accept -> ack (attempt 1/4, 412ms)");
  });

  it("失敗したmessageは原因分類、依存先、次の挙動まで1行で表す", () => {
    expect(
      describeQueueMessageResult({
        flow: "chat-turn",
        outcome: "failed",
        disposition: "retry",
        stage: "ai.generate",
        attempt: 2,
        maxAttempts: 6,
        durationMs: 9820,
        error: {
          errorCode: "DIARY_CHAT_GENERATION_FAILED",
          errorCategory: "dependency",
          stage: "ai.generate",
          retryable: true,
          dependency: "google-ai",
        },
      }),
    ).toBe(
      "[Chat turn] failed at ai.generate -> retry (attempt 2/6, 9820ms, DIARY_CHAT_GENERATION_FAILED, category:dependency, via:google-ai)",
    );
  });

  it("成功以外の終わり方は結果コードを添えて再試行かどうかを示す", () => {
    expect(
      describeQueueMessageResult({
        flow: "chat-turn",
        outcome: "deferred",
        disposition: "retry",
        stage: "generation.acquire",
        attempt: 3,
        maxAttempts: 6,
        durationMs: 22,
        resultCode: "GENERATION_LEASE_BUSY",
      }),
    ).toBe(
      "[Chat turn] deferred at generation.acquire -> retry (attempt 3/6, 22ms, GENERATION_LEASE_BUSY)",
    );
  });

  it("最大試行回数と所要時間が分からない境界でも試行回数だけは残す", () => {
    expect(
      describeQueueMessageResult({
        flow: "diary-brain-checkpoint",
        outcome: "failed",
        disposition: "platform-retry",
        stage: "queue.dispatch",
        attempt: 1,
        error: {
          errorCode: "UNEXPECTED_QUEUE_MESSAGE_ERROR",
          errorCategory: "unknown",
          stage: "queue.dispatch",
          retryable: true,
        },
      }),
    ).toBe(
      "[Diary Brain checkpoint] failed at queue.dispatch -> platform-retry (attempt 1, UNEXPECTED_QUEUE_MESSAGE_ERROR, category:unknown)",
    );
  });

  it("利用者の入力内容や本人識別子をmessageへ載せない", () => {
    const description = describeQueueMessageResult({
      flow: "line-webhook",
      outcome: "failed",
      disposition: "retry",
      stage: "source.store",
      attempt: 1,
      error: {
        errorCode: "LINE_SOURCE_STORE_FAILED",
        errorCategory: "dependency",
        stage: "source.store",
        retryable: true,
        dependency: "account-data",
      },
    });
    expect(description).not.toContain("account-1");
    expect(description).not.toContain("U1234");
  });

  it("アバター処理を専用の処理名で識別する", () => {
    expect(
      describeQueueMessageResult({
        flow: "avatar",
        outcome: "degraded",
        disposition: "ack",
        stage: "candidate.generate",
        attempt: 1,
        maxAttempts: 3,
        resultCode: "AVATAR_CANDIDATES_PARTIALLY_GENERATED",
      }),
    ).toBe(
      "[Avatar] degraded at candidate.generate -> ack (attempt 1/3, AVATAR_CANDIDATES_PARTIALLY_GENERATED)",
    );
  });
});

describe("describeHttpResult", () => {
  it("HTTPの終端ログもQueueと同じ読み方で結果が分かる", () => {
    expect(
      describeHttpResult({
        service: "API",
        method: "POST",
        path: "/api/line/webhook",
        status: 200,
        durationMs: 35,
      }),
    ).toBe("[API] POST /api/line/webhook -> 200 (35ms)");
  });

  it("未捕捉例外で終わった場合はエラーコードまで1行で分かる", () => {
    expect(
      describeHttpResult({
        service: "API",
        method: "GET",
        path: "/api/profile-summary",
        status: 500,
        durationMs: 12,
        errorCode: "UNEXPECTED_API_ERROR",
      }),
    ).toBe("[API] GET /api/profile-summary -> 500 (12ms, UNEXPECTED_API_ERROR)");
  });
});

describe("httpOutcome", () => {
  it("5xxだけを失敗とし、4xxは利用者側で終わった結果として区別する", () => {
    expect(httpOutcome(200)).toBe("succeeded");
    expect(httpOutcome(302)).toBe("succeeded");
    expect(httpOutcome(401)).toBe("discarded");
    expect(httpOutcome(404)).toBe("discarded");
    expect(httpOutcome(500)).toBe("failed");
    expect(httpOutcome(503)).toBe("failed");
  });

  it("levelと組み合わせると4xxがwarn、5xxがerrorになりinfoに埋もれない", () => {
    expect(operationalLogLevel(httpOutcome(200))).toBe("info");
    expect(operationalLogLevel(httpOutcome(401))).toBe("warn");
    expect(operationalLogLevel(httpOutcome(500))).toBe("error");
  });
});

describe("operationalLogLevel", () => {
  it("成功だけをinfoにする", () => {
    expect(operationalLogLevel("succeeded")).toBe("info");
    expect(operationalLogLevel("degraded")).toBe("warn");
    expect(operationalLogLevel("deferred")).toBe("warn");
    expect(operationalLogLevel("discarded")).toBe("warn");
    expect(operationalLogLevel("failed")).toBe("error");
  });

  it("縮退成功でも例外を伴う結果はerrorとして扱う", () => {
    expect(operationalLogLevel("degraded", true)).toBe("error");
  });
});
