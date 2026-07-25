import { messagingApi } from "@line/bot-sdk";
import { config as defaultConfig } from "../config";

export interface LineWebhookConfig {
  channelAccessToken?: string;
  webhookUrl?: string;
}

/**
 * LINE Messaging API SDK (@line/bot-sdk) を使用して Webhook Endpoint URL を登録・更新します。
 */
export async function registerLineWebhook(
  config?: LineWebhookConfig,
): Promise<{ success: boolean; message: string }> {
  const token = config?.channelAccessToken || defaultConfig.lineChannelAccessToken;
  const url = config?.webhookUrl || defaultConfig.lineWebhookUrl;

  if (!token || !url) {
    const msg =
      "[LINE Webhook] LINE_CHANNEL_ACCESS_TOKEN または Webhook URL (LINE_WEBHOOK_URL / BASE_URL) が設定されていないため自動登録をスキップします。";
    console.log(msg);
    return { success: false, message: msg };
  }

  try {
    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: token,
    });

    await client.setWebhookEndpoint({
      endpoint: url,
    });

    const msg = `[LINE Webhook] LINE Messaging API SDK により Webhook URL を正常に登録しました: ${url}`;
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    const msg = `[LINE Webhook] LINE Messaging API SDK でのエラーが発生しました: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.error(msg);
    return { success: false, message: msg };
  }
}
