import { messagingApi } from "@line/bot-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { line } from "./index";

vi.mock("@line/bot-sdk", () => {
  const setWebhookEndpointMock = vi.fn();
  const getWebhookEndpointMock = vi.fn().mockResolvedValue({
    endpoint: "https://example.com/api/line/webhook",
    active: true,
  });
  const testWebhookEndpointMock = vi.fn().mockResolvedValue({
    success: true,
    statusCode: 200,
    reason: "OK",
  });
  function MessagingApiClientMock(this: {
    setWebhookEndpoint: typeof setWebhookEndpointMock;
    getWebhookEndpoint: typeof getWebhookEndpointMock;
    testWebhookEndpoint: typeof testWebhookEndpointMock;
  }) {
    this.setWebhookEndpoint = setWebhookEndpointMock;
    this.getWebhookEndpoint = getWebhookEndpointMock;
    this.testWebhookEndpoint = testWebhookEndpointMock;
  }
  return {
    messagingApi: {
      MessagingApiClient: vi.fn(MessagingApiClientMock),
    },
  };
});

describe("line.client & line.webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("line.client.create creates a MessagingApiClient", () => {
    const c = line.client.create("token-abc");
    expect(c).toBeDefined();
    expect(messagingApi.MessagingApiClient).toHaveBeenCalledWith({
      channelAccessToken: "token-abc",
    });
  });

  it("line.webhook.register skips registration when token or url is missing", async () => {
    const res1 = await line.webhook.register({});
    expect(res1.success).toBe(false);

    const res2 = await line.webhook.register({ channelAccessToken: "token" });
    expect(res2.success).toBe(false);
  });

  it("line.webhook.register skips re-registration when the endpoint is already active", async () => {
    const res = await line.webhook.register({
      channelAccessToken: "token-123",
      webhookUrl: "https://example.com/api/line/webhook",
    });
    expect(res).toMatchObject({ success: true, skipped: true });

    const clientInstance = (messagingApi.MessagingApiClient as unknown as ReturnType<typeof vi.fn>)
      .mock.results[0]?.value;
    expect(clientInstance.getWebhookEndpoint).toHaveBeenCalledOnce();
    // 登録済みなら書き換えも、LINE Platform からの往復を待つ疎通確認も走らせない。
    expect(clientInstance.setWebhookEndpoint).not.toHaveBeenCalled();
    expect(clientInstance.testWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("line.webhook.register registers and verifies when the endpoint differs", async () => {
    const clientInstance = line.client.create("token-123");
    vi.mocked(clientInstance.getWebhookEndpoint).mockResolvedValueOnce({
      endpoint: "https://old.example.com/api/line/webhook",
      active: true,
    });

    const res = await line.webhook.register({
      channelAccessToken: "token-123",
      webhookUrl: "https://example.com/api/line/webhook",
    });
    expect(res).toMatchObject({ success: true, skipped: false });

    expect(clientInstance.setWebhookEndpoint).toHaveBeenCalledWith({
      endpoint: "https://example.com/api/line/webhook",
    });
    expect(clientInstance.testWebhookEndpoint).toHaveBeenCalledWith({
      endpoint: "https://example.com/api/line/webhook",
    });
  });

  it("line.webhook.register re-verifies an up-to-date endpoint when forceVerify is set", async () => {
    const res = await line.webhook.register({
      channelAccessToken: "token-123",
      webhookUrl: "https://example.com/api/line/webhook",
      forceVerify: true,
    });
    expect(res).toMatchObject({ success: true, skipped: false });

    const clientInstance = (messagingApi.MessagingApiClient as unknown as ReturnType<typeof vi.fn>)
      .mock.results[0]?.value;
    expect(clientInstance.setWebhookEndpoint).toHaveBeenCalledWith({
      endpoint: "https://example.com/api/line/webhook",
    });
    expect(clientInstance.testWebhookEndpoint).toHaveBeenCalledWith({
      endpoint: "https://example.com/api/line/webhook",
    });
  });

  it("line.webhook.register rejects an inactive webhook", async () => {
    const clientInstance = line.client.create("token-inactive");
    // 事前確認と、登録後の検証の 2 回とも「無効」を返す。
    vi.mocked(clientInstance.getWebhookEndpoint)
      .mockResolvedValueOnce({
        endpoint: "https://example.com/api/line/webhook",
        active: false,
      })
      .mockResolvedValueOnce({
        endpoint: "https://example.com/api/line/webhook",
        active: false,
      });

    await expect(
      line.webhook.register({
        channelAccessToken: "token-inactive",
        webhookUrl: "https://example.com/api/line/webhook",
      }),
    ).resolves.toMatchObject({ success: false });
    expect(clientInstance.testWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("line.webhook.register rejects a failed endpoint test", async () => {
    const clientInstance = line.client.create("token-unreachable");
    vi.mocked(clientInstance.testWebhookEndpoint).mockResolvedValueOnce({
      success: false,
      timestamp: new Date(),
      statusCode: 500,
      reason: "INTERNAL_SERVER_ERROR",
      detail: "",
    });

    await expect(
      line.webhook.register({
        channelAccessToken: "token-unreachable",
        webhookUrl: "https://example.com/api/line/webhook",
        forceVerify: true,
      }),
    ).resolves.toMatchObject({ success: false });
  });
});
