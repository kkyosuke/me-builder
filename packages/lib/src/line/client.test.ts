import { messagingApi } from "@line/bot-sdk";
import { describe, expect, it, vi } from "vitest";
import { line } from "./index";

vi.mock("@line/bot-sdk", () => {
  const setWebhookEndpointMock = vi.fn();
  function MessagingApiClientMock(this: { setWebhookEndpoint: typeof setWebhookEndpointMock }) {
    this.setWebhookEndpoint = setWebhookEndpointMock;
  }
  return {
    messagingApi: {
      MessagingApiClient: vi.fn(MessagingApiClientMock),
    },
  };
});

describe("line.client & line.webhook", () => {
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

  it("line.webhook.register calls setWebhookEndpoint on MessagingApiClient", async () => {
    const res = await line.webhook.register({
      channelAccessToken: "token-123",
      webhookUrl: "https://example.com/api/line/webhook",
    });
    expect(res.success).toBe(true);

    const clientInstance = (messagingApi.MessagingApiClient as unknown as ReturnType<typeof vi.fn>)
      .mock.results[0]?.value;
    expect(clientInstance.setWebhookEndpoint).toHaveBeenCalledWith({
      endpoint: "https://example.com/api/line/webhook",
    });
  });
});
