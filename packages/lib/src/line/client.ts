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

/**
 * 画像などのバイナリを扱う LINE Messaging API クライアントを生成します。
 */
function createBlob(channelAccessToken: string): messagingApi.MessagingApiBlobClient {
  return new messagingApi.MessagingApiBlobClient({
    channelAccessToken,
  });
}

export const client: {
  create: (channelAccessToken: string) => messagingApi.MessagingApiClient;
  createBlob: (channelAccessToken: string) => messagingApi.MessagingApiBlobClient;
} = {
  create,
  createBlob,
};
