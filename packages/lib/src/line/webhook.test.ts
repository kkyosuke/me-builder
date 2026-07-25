import { messagingApi } from "@line/bot-sdk";
import { describe, expect, it, vi } from "vitest";
import { line } from "./index";

vi.mock("@line/bot-sdk", () => {
  const replyMessageMock = vi.fn().mockResolvedValue({});
  return {
    messagingApi: {
      MessagingApiClient: vi.fn().mockImplementation(() => ({
        replyMessage: replyMessageMock,
      })),
    },
  };
});

describe("line.webhook.parseEvents", () => {
  it("returns empty array for invalid payload", () => {
    expect(line.webhook.parseEvents(null)).toEqual([]);
    expect(line.webhook.parseEvents({})).toEqual([]);
    expect(line.webhook.parseEvents({ events: "not-an-array" })).toEqual([]);
  });

  it("returns events array for valid payload", () => {
    const payload = {
      events: [
        { type: "message", replyToken: "token-123", message: { type: "text", text: "hello" } },
      ],
    };
    expect(line.webhook.parseEvents(payload)).toEqual(payload.events);
  });
});

describe("line.webhook.extractMessages", () => {
  it("extracts text messages from valid payload", () => {
    const payload = {
      events: [
        { type: "message", message: { type: "text", text: "hello" } },
        { type: "follow" },
        { type: "message", message: { type: "text", text: "world" } },
      ],
    };
    expect(line.webhook.extractMessages(payload)).toEqual(["hello", "world"]);
  });

  it("returns empty array for invalid payloads", () => {
    expect(line.webhook.extractMessages(null)).toEqual([]);
    expect(line.webhook.extractMessages({})).toEqual([]);
    expect(line.webhook.extractMessages({ events: "not-an-array" })).toEqual([]);
  });
});
