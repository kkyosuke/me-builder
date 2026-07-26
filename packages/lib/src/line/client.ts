import { messagingApi } from "@line/bot-sdk";
import type { LineConfig } from "./config";

export type LineClientConfig = LineConfig;

/**
 * LINE Messaging API クライアントを生成します。
 */
function create(channelAccessToken: string): messagingApi.MessagingApiClient {
  return new messagingApi.MessagingApiClient({
    channelAccessToken,
  });
}

export const client: {
  create: (channelAccessToken: string) => messagingApi.MessagingApiClient;
} = {
  create,
};
