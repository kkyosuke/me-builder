import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerLineWebhook } from "./line-webhook";

const mockSetWebhookEndpoint = vi.fn();

vi.mock("@line/bot-sdk", () => {
  return {
    messagingApi: {
      MessagingApiClient: vi.fn().mockImplementation(() => ({
        setWebhookEndpoint: mockSetWebhookEndpoint,
      })),
    },
  };
});

describe("registerLineWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("トークンまたはURLが無い場合はスキップされること", async () => {
    const result = await registerLineWebhook({});
    expect(result.success).toBe(false);
    expect(result.message).toContain("自動登録をスキップします");
  });

  it("LINE SDK を用いて正常に Webhook Endpoint を登録できること", async () => {
    mockSetWebhookEndpoint.mockResolvedValue({});

    const result = await registerLineWebhook({
      channelAccessToken: "test-token",
      webhookUrl: "https://example.com/api/line/webhook",
    });

    expect(result.success).toBe(true);
    expect(mockSetWebhookEndpoint).toHaveBeenCalledWith({
      endpoint: "https://example.com/api/line/webhook",
    });
  });

  it("LINE SDK がエラーを送出した場合失敗メッセージを返すこと", async () => {
    mockSetWebhookEndpoint.mockRejectedValue(new Error("API Error"));

    const result = await registerLineWebhook({
      channelAccessToken: "test-token",
      webhookUrl: "https://example.com/api/line/webhook",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("API Error");
  });
});
