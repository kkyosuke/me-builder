import type { messagingApi } from "@line/bot-sdk";
import { logger } from "@me-builder/shared";
import { client } from "./client";

const MENU_WIDTH = 2500;
const MENU_HEIGHT = 843;

export type RegisterDefaultRichMenuParams = {
  channelAccessToken?: string | undefined;
  /** メニューの用途と環境を表す接頭辞。旧版の特定にも使います。 */
  namePrefix: string;
  /** 画像内容を識別する短い版。 */
  version: string;
  liffId?: string | undefined;
  image: Blob;
};

export type RegisterDefaultRichMenuResult = {
  success: boolean;
  message: string;
  richMenuId?: string;
};

function createDefinition(name: string, liffId: string): messagingApi.RichMenuRequest {
  return {
    size: { width: MENU_WIDTH, height: MENU_HEIGHT },
    selected: true,
    name,
    chatBarText: "メニューを開く",
    areas: [
      {
        bounds: { x: 0, y: 0, width: MENU_WIDTH, height: MENU_HEIGHT },
        action: {
          type: "uri",
          label: "診断を行う",
          uri: `https://liff.line.me/${liffId}`,
        },
      },
    ],
  };
}

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 「診断を行う」1ボタンのリッチメニューを作成し、全ユーザーの既定値にします。
 *
 * 同じ画像版が登録済みなら再利用します。新しい版を既定値にした後、同じ接頭辞を持つ
 * 旧版だけを削除するため、preview / production や他用途のメニューには触れません。
 */
async function registerDefault(
  params: RegisterDefaultRichMenuParams,
): Promise<RegisterDefaultRichMenuResult> {
  const { channelAccessToken, liffId, image, namePrefix, version } = params;

  if (!channelAccessToken || !liffId) {
    const message =
      "[LINE Rich Menu] LINE_CHANNEL_ACCESS_TOKEN または LIFF_ID が設定されていないため自動登録をスキップします。";
    logger.info(message);
    return { success: false, message };
  }

  const apiClient = client.create(channelAccessToken);
  const blobClient = client.createBlob(channelAccessToken);
  const name = `${namePrefix}-${version}`;
  let createdRichMenuId: string | undefined;

  try {
    const listed = await apiClient.getRichMenuList();
    const existing = listed.richmenus.find((menu) => menu.name === name);
    let richMenuId = existing?.richMenuId;

    if (!richMenuId) {
      const created = await apiClient.createRichMenu(createDefinition(name, liffId));
      richMenuId = created.richMenuId;
      createdRichMenuId = richMenuId;
      await blobClient.setRichMenuImage(richMenuId, image);
    }

    await apiClient.setDefaultRichMenu(richMenuId);

    const obsoleteMenus = listed.richmenus.filter(
      (menu) => menu.name.startsWith(`${namePrefix}-`) && menu.richMenuId !== richMenuId,
    );
    for (const obsolete of obsoleteMenus) {
      try {
        await apiClient.deleteRichMenu(obsolete.richMenuId);
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          `[LINE Rich Menu] 旧版リッチメニューを削除できませんでした: ${obsolete.richMenuId}`,
        );
      }
    }

    const message = `[LINE Rich Menu] 既定リッチメニューを設定しました: ${richMenuId}`;
    logger.info(message);
    return { success: true, message, richMenuId };
  } catch (error) {
    if (createdRichMenuId) {
      try {
        await apiClient.deleteRichMenu(createdRichMenuId);
      } catch {
        // 作成途中のメニューを可能な範囲で片付ける。元のエラーを優先して返す。
      }
    }
    const detail = toMessage(error).replaceAll(channelAccessToken, "***");
    const message = `[LINE Rich Menu] 自動登録に失敗しました: ${detail}`;
    logger.error(message);
    return { success: false, message };
  }
}

export const richMenu: {
  registerDefault: (
    params: RegisterDefaultRichMenuParams,
  ) => Promise<RegisterDefaultRichMenuResult>;
} = {
  registerDefault,
};
